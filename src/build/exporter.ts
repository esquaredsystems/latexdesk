// "Export for submission" (wireframe 1u): collects the files a document needs, optionally
// flattens includes and strips comments, checks for common arXiv problems, writes a folder or
// ZIP, and verifies the result by compiling a copy in a temporary folder.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { Project } from '../core/project';
import { flattenTex, stripComments } from '../core/flatten';
import { BuildRun } from './runner';
import { BUILTIN_RECIPES, BUILTIN_TOOLS } from './recipes';

export type Preset = 'arxiv' | 'journal' | 'project' | 'custom';

export interface ExportOptions {
  /** Every source file in the project folder (the "Source ZIP", OL-48); takes precedence over usedFilesOnly. */
  allSourceFiles: boolean;
  /** Use the compiler's .fls record to include only files that were really read. */
  usedFilesOnly: boolean;
  flatten: boolean;
  includeBbl: boolean;
  stripComments: boolean;
  includePdf: boolean;
  manifest: boolean;
}

export const PRESETS: Record<Exclude<Preset, 'custom'>, ExportOptions> = {
  arxiv: { allSourceFiles: false, usedFilesOnly: true, flatten: false, includeBbl: true, stripComments: true, includePdf: false, manifest: false },
  journal: { allSourceFiles: false, usedFilesOnly: true, flatten: true, includeBbl: true, stripComments: true, includePdf: true, manifest: true },
  project: { allSourceFiles: true, usedFilesOnly: false, flatten: false, includeBbl: false, stripComments: false, includePdf: false, manifest: false },
};

export interface ExportFile {
  /** Path inside the export, with forward slashes. */
  target: string;
  source: string;
  size: number;
  /** Text after flattening / comment stripping; undefined means copy the source as is. */
  content?: string;
}

export interface ExportCheck {
  level: 'ok' | 'warning' | 'error';
  message: string;
}

export interface ExportPlan {
  files: ExportFile[];
  checks: ExportCheck[];
  totalBytes: number;
  notes: string[];
}

const GENERATED = /\.(aux|bbl|toc|lof|lot|loa|out|log|fls|fdb_latexmk|synctex(\.gz)?|idx|ilg|ind|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi)$/i;
const ARXIV_TYPES = /\.(tex|bib|bbl|bst|cls|sty|clo|cfg|def|fd|ind|png|jpe?g|pdf|eps|ps|txt|tikz|pgf|dat|csv|mf|pfb|tfm|map|enc)$/i;

export function planExport(project: Project, outDir: string, jobName: string, options: ExportOptions, preset: Preset): ExportPlan {
  const rootDir = project.rootDir;
  const notes: string[] = [];
  const sources = new Set<string>();
  const inside = (f: string) => !path.relative(rootDir, f).startsWith('..') && !path.isAbsolute(path.relative(rootDir, f));

  const fls = readText(path.join(outDir, jobName + '.fls'));
  if (options.allSourceFiles) {
    const found = listSourceFiles(rootDir, outDir);
    found.files.forEach((f) => sources.add(f));
    notes.push(...found.notes);
  } else if (options.usedFilesOnly && fls) {
    for (const m of fls.matchAll(/^INPUT (.+)$/gm)) {
      const file = path.resolve(rootDir, m[1].trim());
      if (inside(file) && !GENERATED.test(file) && !file.includes(`${path.sep}.latexdesk${path.sep}`)) sources.add(file);
    }
    // .bib files are read by bibtex/biber, not by the engine, so the .fls does not list them.
    project.bibFiles.forEach((b) => sources.add(b));
  } else {
    if (options.usedFilesOnly) notes.push('No .fls file yet (build once with latexmk or -recorder); using the files found by the project scan.');
    project.files.forEach((f) => sources.add(f.path));
    project.bibFiles.forEach((b) => sources.add(b));
    project.styleFiles.forEach((s) => sources.add(s));
    for (const g of project.graphics) if (g.resolved) sources.add(g.resolved);
  }
  sources.add(project.root);

  const report = { warnings: [] as string[], inlined: new Set<string>() };
  const read = (f: string) => readText(f);
  const flatRoot = options.flatten ? flattenTex(project.root, read, report) : undefined;
  const files: ExportFile[] = [];
  for (const source of [...sources].filter(inside)) {
    if (report.inlined.has(source)) continue; // now part of the root file
    const target = path.relative(rootDir, source).split(path.sep).join('/');
    let content = source === project.root ? flatRoot : undefined;
    if (options.stripComments && source.endsWith('.tex')) content = stripComments(content ?? read(source) ?? '');
    const size = content !== undefined ? Buffer.byteLength(content) : statSize(source);
    files.push({ target, source, size, content });
  }
  notes.push(...report.warnings);

  const bbl = path.join(outDir, jobName + '.bbl');
  if (options.includeBbl && fs.existsSync(bbl)) files.push({ target: path.relative(rootDir, path.join(rootDir, jobName + '.bbl')).split(path.sep).join('/'), source: bbl, size: statSize(bbl) });
  const pdf = path.join(outDir, jobName + '.pdf');
  if (options.includePdf && fs.existsSync(pdf)) files.push({ target: jobName + '.pdf', source: pdf, size: statSize(pdf) });
  // A file can be reached twice (e.g. listed in the .fls and added as an option); keep the first.
  const unique = files.filter((f, i) => files.findIndex((g) => g.target === f.target) === i);
  files.length = 0;
  files.push(...unique.sort((a, b) => a.target.localeCompare(b.target)));
  if (options.manifest) {
    const content = files.map((f) => `${f.target}\t${f.size}`).join('\n') + '\n';
    files.push({ target: 'MANIFEST.txt', source: '', size: content.length, content });
  }

  return { files, checks: checks(project, files, options, preset), totalBytes: files.reduce((n, f) => n + f.size, 0), notes };
}

// Build output that never belongs in a source archive. A .bbl is added back only on request.
const BUILD_OUTPUT =
  /\.(aux|bbl|blg|toc|lof|lot|loa|lol|out|log|fls|fdb_latexmk|synctex|synctex\.gz|synctex\(busy\)|idx|ilg|ind|bcf|run\.xml|nav|snm|vrb|xdv|dvi|glo|gls|glg|acn|acr|alg|nlo|nls|nlg|brf|thm|tdo|auxlock)$|-blx\.bib$/i;
const SKIPPED_FOLDERS = new Set(['.git', '.svn', '.hg', '.vscode', '.idea', '.latexdesk', 'node_modules', '__MACOSX', 'svg-inkscape']);
const SYSTEM_FILES = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$|^\._|~$|\.(bak|swp|swo)$/i;
const MAX_FILES = 20000;

/**
 * Every source file under `rootDir` (OL-48): the folder walk behind the Source ZIP. Leaves out
 * build output, compiled PDFs (X.pdf next to X.tex, and anything in a separate output folder),
 * tool and system folders, backups and ZIP files. Figures in PDF format are kept.
 */
export function listSourceFiles(rootDir: string, outDir: string): { files: string[]; notes: string[] } {
  const files: string[] = [];
  const skipped = { build: 0, pdf: 0, folders: 0, system: 0, zip: 0, links: 0 };
  const realRoot = safeRealpath(rootDir) ?? rootDir;
  const separateOut = path.resolve(outDir) !== path.resolve(rootDir) ? path.resolve(outDir) : undefined;

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        // Follow a link to a file only when it stays inside the project folder.
        const real = safeRealpath(full);
        if (!real || path.relative(realRoot, real).startsWith('..') || !fs.statSync(real).isFile()) {
          skipped.links++;
          continue;
        }
      } else if (e.isDirectory()) {
        if (SKIPPED_FOLDERS.has(e.name) || e.name.startsWith('_minted') || path.resolve(full) === separateOut) skipped.folders++;
        else walk(full);
        continue;
      } else if (!e.isFile()) continue;

      if (SYSTEM_FILES.test(e.name)) skipped.system++;
      else if (BUILD_OUTPUT.test(e.name)) skipped.build++;
      else if (/\.zip$/i.test(e.name)) skipped.zip++;
      else if (/\.pdf$/i.test(e.name) && (names.has(e.name.slice(0, -4) + '.tex') || /-watermarked\.pdf$/i.test(e.name))) skipped.pdf++;
      else files.push(full);
    }
  };
  walk(rootDir);

  const notes: string[] = [];
  const left: string[] = [];
  if (skipped.pdf) left.push(`${skipped.pdf} compiled PDF${skipped.pdf > 1 ? 's' : ''}`);
  if (skipped.build) left.push(`${skipped.build} build file${skipped.build > 1 ? 's' : ''}`);
  if (skipped.folders) left.push(`${skipped.folders} tool or output folder${skipped.folders > 1 ? 's' : ''}`);
  if (skipped.system) left.push(`${skipped.system} system or backup file${skipped.system > 1 ? 's' : ''}`);
  if (skipped.zip) left.push(`${skipped.zip} ZIP file${skipped.zip > 1 ? 's' : ''}`);
  if (left.length) notes.push(`Left out: ${left.join(', ')}.`);
  if (skipped.links) notes.push(`${skipped.links} link${skipped.links > 1 ? 's' : ''} pointing outside the project folder skipped.`);
  if (files.length >= MAX_FILES) notes.push(`Stopped after ${MAX_FILES} files; is the root document in the right folder?`);
  return { files, notes };
}

function safeRealpath(file: string): string | undefined {
  try {
    return fs.realpathSync(file);
  } catch {
    return undefined;
  }
}

function checks(project: Project, files: ExportFile[], options: ExportOptions, preset: Preset): ExportCheck[] {
  const result: ExportCheck[] = [];
  const usesBib = project.bibFiles.length > 0;
  if (usesBib) {
    const hasBbl = files.some((f) => f.target.endsWith('.bbl'));
    if (hasBbl) result.push({ level: 'ok', message: '.bbl present' });
    else result.push({ level: preset === 'arxiv' ? 'error' : 'warning', message: options.includeBbl ? 'No .bbl file: build the project first' : '.bbl not included (arXiv does not run BibTeX)' });
  }
  const byLower = new Map<string, string[]>();
  for (const f of files) byLower.set(f.target.toLowerCase(), [...(byLower.get(f.target.toLowerCase()) ?? []), f.target]);
  for (const names of byLower.values()) if (names.length > 1) result.push({ level: 'warning', message: `${names.join(' vs ')} — case collision` });
  for (const f of files) {
    if (/\s/.test(f.target)) result.push({ level: 'warning', message: `${f.target} — space in name` });
    if (f.size > 10 * 1024 * 1024) result.push({ level: 'warning', message: `${f.target} — ${(f.size / 1048576).toFixed(1)} MB` });
  }
  const odd = files.filter((f) => f.target !== 'MANIFEST.txt' && !ARXIV_TYPES.test(f.target));
  if (preset === 'arxiv') {
    if (odd.length) for (const f of odd) result.push({ level: 'warning', message: `${f.target} — file type arXiv may reject` });
    else result.push({ level: 'ok', message: 'No unusual file types' });
  }
  const unresolved = project.unresolved.filter((u) => u.kind !== 'bibliography');
  if (unresolved.length) result.push({ level: 'warning', message: `${unresolved.length} include or graphic not found by the project scan` });
  return result;
}

/** Writes the export to a folder (which must not exist yet) or a .zip file. */
export async function writeExport(plan: ExportPlan, target: string, format: 'folder' | 'zip') {
  if (format === 'folder') {
    if (fs.existsSync(target)) throw new Error(`${target} already exists`);
    for (const f of plan.files) {
      const dest = path.join(target, f.target);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (f.content !== undefined) fs.writeFileSync(dest, f.content);
      else fs.copyFileSync(f.source, dest);
    }
    return;
  }
  const zip = new JSZip();
  for (const f of plan.files) zip.file(f.target, f.content ?? fs.readFileSync(f.source));
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(target, data);
}

/** Compiles the export in a fresh temporary folder. Returns whether a PDF was produced, plus the log tail. */
export async function verifyExport(plan: ExportPlan, rootTarget: string, jobName: string, executablePaths: Record<string, string> = {}): Promise<{ ok: boolean; message: string; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latexdesk-verify-'));
  await writeExport(plan, path.join(dir, 'src'), 'folder');
  const src = path.join(dir, 'src');
  const rootDir = path.dirname(path.join(src, rootTarget));
  const run = new BuildRun({
    recipe: BUILTIN_RECIPES[0],
    tools: BUILTIN_TOOLS,
    placeholders: { DOC: jobName, DOCFILE: jobName, DOC_EXT: path.basename(rootTarget), DIR: rootDir, OUTDIR: rootDir, PATHSEP: path.delimiter },
    executablePaths,
    timeoutMs: 10 * 60 * 1000,
  });
  const result = await run.run();
  const pdf = path.join(rootDir, jobName + '.pdf');
  const log = readText(path.join(rootDir, jobName + '.log')) ?? '';
  const errors = (log.match(/^! |^\S+:\d+: /gm) ?? []).length;
  const ok = fs.existsSync(pdf) && errors === 0 && !result.cancelled;
  const message = ok ? 'The exported copy compiles.' : result.missingExecutable ? `${result.missingExecutable} not found` : `${errors} error${errors === 1 ? '' : 's'} when compiling the exported copy`;
  if (ok) fs.rmSync(dir, { recursive: true, force: true });
  return { ok, message, dir: ok ? '' : rootDir };
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function statSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
