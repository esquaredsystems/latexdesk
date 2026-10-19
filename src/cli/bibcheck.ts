// latexdesk-bibcheck: the same bibliography checker as the extension, for CI and pre-commit hooks.
//
//   latexdesk-bibcheck refs.bib [more.bib] [--profile minimal|standard|strict]
//       [--dialect bibtex|biblatex] [--tex main.tex] [--format text|json|sarif] [--fail-on error|warning|none]
import * as fs from 'fs';
import * as path from 'path';
import { parseBib } from '../core/bibParser';
import { scanBib, Dialect, Profile, BibFinding, Severity } from '../core/bibScanner';
import { loadProject } from '../core/project';

interface Options {
  files: string[];
  profile: Profile;
  dialect?: Dialect;
  tex?: string;
  format: 'text' | 'json' | 'sarif';
  failOn: 'error' | 'warning' | 'none';
}

function parseArgs(argv: string[]): Options {
  const options: Options = { files: [], profile: 'standard', format: 'text', failOn: 'error' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--profile') options.profile = next() as Profile;
    else if (a === '--dialect') options.dialect = next() as Dialect;
    else if (a === '--tex') options.tex = next();
    else if (a === '--format') options.format = next() as Options['format'];
    else if (a === '--fail-on') options.failOn = next() as Options['failOn'];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: latexdesk-bibcheck <file.bib...> [--profile minimal|standard|strict] [--dialect bibtex|biblatex] [--tex main.tex] [--format text|json|sarif] [--fail-on error|warning|none]');
      process.exit(0);
    } else options.files.push(a);
  }
  return options;
}

const host = {
  readFile: async (f: string) => {
    try {
      return await fs.promises.readFile(f, 'utf8');
    } catch {
      return undefined;
    }
  },
  exists: async (f: string) => fs.existsSync(f),
};

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  let citedKeys: Set<string> | undefined;
  let dialect: Dialect = options.dialect ?? 'bibtex';
  if (options.tex) {
    const project = await loadProject(path.resolve(options.tex), host);
    citedKeys = new Set(project.files.flatMap((f) => f.index.citations.map((c) => c.key)));
    if (!options.dialect && project.files.some((f) => f.index.packages.some((p) => p.name === 'biblatex'))) dialect = 'biblatex';
    if (!options.files.length) options.files = project.bibFiles;
  }
  if (!options.files.length) {
    console.error('No .bib files given.');
    return 2;
  }

  const results: { file: string; findings: (BibFinding & { line: number; column: number })[] }[] = [];
  for (const file of options.files) {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parseBib(text);
    const scan = scanBib(parsed, text, { dialect, profile: options.profile, citedKeys });
    results.push({
      file,
      findings: scan.findings.map((f) => {
        const p = parsed.lines.position(f.start);
        return { ...f, line: p.line + 1, column: p.character + 1 };
      }),
    });
  }

  if (options.format === 'json') console.log(JSON.stringify(results, null, 2));
  else if (options.format === 'sarif') console.log(JSON.stringify(toSarif(results), null, 2));
  else {
    for (const r of results) {
      for (const f of r.findings) console.log(`${r.file}:${f.line}:${f.column}: ${f.severity}: ${f.message} [${f.code}]`);
    }
    const all = results.flatMap((r) => r.findings);
    console.log(`\n${all.length} findings (${count(all, 'error')} errors, ${count(all, 'warning')} warnings) · profile ${options.profile} · ${dialect}`);
  }

  const all = results.flatMap((r) => r.findings);
  if (options.failOn === 'error' && count(all, 'error') > 0) return 1;
  if (options.failOn === 'warning' && count(all, 'error') + count(all, 'warning') > 0) return 1;
  return 0;
}

function count(findings: { severity: Severity }[], s: Severity) {
  return findings.filter((f) => f.severity === s).length;
}

function toSarif(results: { file: string; findings: (BibFinding & { line: number; column: number })[] }[]) {
  const level = (s: Severity) => (s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'note');
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: { driver: { name: 'latexdesk-bibcheck', informationUri: 'https://github.com/esquaredsystems/latexdesk' } },
        results: results.flatMap((r) =>
          r.findings.map((f) => ({
            ruleId: f.code,
            level: level(f.severity),
            message: { text: f.message },
            locations: [{ physicalLocation: { artifactLocation: { uri: r.file }, region: { startLine: f.line, startColumn: f.column } } }],
          })),
        ),
      },
    ],
  };
}

if (require.main === module) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(2);
    },
  );
}
