// Finds which LaTeX tools are installed. Runs asynchronously and caches the result.
import { execFile } from 'child_process';

export interface ToolInfo {
  name: string;
  neededFor: string;
  required: boolean;
  path?: string;
  version?: string;
}

export const KNOWN_TOOLS: { name: string; neededFor: string; required?: boolean }[] = [
  { name: 'latexmk', neededFor: 'build (recommended)', required: true },
  { name: 'pdflatex', neededFor: 'build', required: true },
  { name: 'xelatex', neededFor: 'build with XeLaTeX' },
  { name: 'lualatex', neededFor: 'build with LuaLaTeX' },
  { name: 'tectonic', neededFor: 'build with Tectonic' },
  { name: 'bibtex', neededFor: 'bibliographies (BibTeX)' },
  { name: 'biber', neededFor: 'bibliographies (biblatex)' },
  { name: 'makeindex', neededFor: 'indexes' },
  { name: 'kpsewhich', neededFor: 'package check' },
  { name: 'synctex', neededFor: 'fallback only (in-process reader used)' },
  { name: 'latexindent', neededFor: 'formatting (optional)' },
  { name: 'tex-fmt', neededFor: 'formatting (optional)' },
  { name: 'chktex', neededFor: 'lint (optional)' },
  { name: 'texcount', neededFor: 'word count (optional)' },
];

function run(cmd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? undefined : stdout.toString()));
  });
}

async function locate(cmd: string): Promise<string | undefined> {
  const out = process.platform === 'win32' ? await run('where', [cmd]) : await run('which', [cmd]);
  return out?.split(/\r?\n/)[0]?.trim() || undefined;
}

export async function detectTools(overrides: Record<string, string> = {}): Promise<ToolInfo[]> {
  return Promise.all(
    KNOWN_TOOLS.map(async (t) => {
      const path = overrides[t.name] || (await locate(t.name));
      let version: string | undefined;
      if (path) {
        const out = await run(path, ['--version']);
        version = out?.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 80);
      }
      return { name: t.name, neededFor: t.neededFor, required: !!t.required, path, version };
    }),
  );
}

/** Runs kpsewhich for each package and returns the ones TeX cannot find. */
export async function missingPackages(packages: string[], kpsewhich = 'kpsewhich'): Promise<string[]> {
  const missing: string[] = [];
  for (const p of packages) {
    const out = await run(kpsewhich, [`${p}.sty`]);
    if (!out?.trim()) missing.push(p);
  }
  return missing;
}
