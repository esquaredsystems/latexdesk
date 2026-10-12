// Builds the project model: which files belong to a root document, which bibliographies
// and graphics it uses, and which includes cannot be resolved.
import * as path from 'path';
import { parseTex, TexFileIndex, Located } from './texParser';

/** File access is injected so the same code runs in the extension, the CLI and tests. */
export interface FileHost {
  readFile(file: string): Promise<string | undefined>;
  exists(file: string): Promise<boolean>;
}

export interface ProjectFile {
  path: string;
  index: TexFileIndex;
  /** Directory that relative \input paths inside this file resolve against. */
  baseDir: string;
  /** Resolved includes in source order (offset of the include command and the included file). */
  children: { offset: number; path: string }[];
}

export interface Unresolved extends Located {
  file: string;
  target: string;
  kind: 'include' | 'bibliography' | 'graphic';
}

export interface ResolvedGraphic extends Located {
  file: string;
  target: string;
  resolved?: string;
}

export interface Project {
  root: string;
  rootDir: string;
  /** All source files in include order, root first. */
  files: ProjectFile[];
  bibFiles: string[];
  /** Local .cls / .sty files used by the project. */
  styleFiles: string[];
  graphics: ResolvedGraphic[];
  unresolved: Unresolved[];
  /** child file -> parent file */
  parents: Map<string, string>;
}

/** The order pdflatex's graphicx tries extensions in. */
export const GRAPHIC_EXTENSIONS = ['.pdf', '.png', '.jpg', '.mps', '.jpeg', '.PDF', '.PNG', '.JPG', '.JPEG', '.eps', '.svg'];

export interface ParseCache {
  get(file: string): TexFileIndex | undefined;
  set(file: string, index: TexFileIndex): void;
}

export async function loadProject(root: string, host: FileHost, cache?: ParseCache): Promise<Project> {
  const rootDir = path.dirname(root);
  const project: Project = {
    root,
    rootDir,
    files: [],
    bibFiles: [],
    styleFiles: [],
    graphics: [],
    unresolved: [],
    parents: new Map(),
  };
  const visited = new Set<string>();

  async function visit(file: string, baseDir: string, parent?: string) {
    const key = path.normalize(file);
    if (visited.has(key)) return; // cycles and repeated \input are fine
    visited.add(key);
    let index = cache?.get(key);
    if (!index) {
      const text = await host.readFile(key);
      if (text === undefined) return;
      index = parseTex(text);
      cache?.set(key, index);
    }
    if (parent) project.parents.set(key, parent);
    const projectFile: ProjectFile = { path: key, index, baseDir, children: [] };
    project.files.push(projectFile);

    for (const inc of index.includes) {
      let dir = baseDir;
      let target: string | undefined;
      if (inc.kind === 'import') {
        dir = path.resolve(path.dirname(key), inc.dir ?? '');
        target = await resolveTex(host, [dir], inc.path);
      } else if (inc.kind === 'subfile') {
        target = await resolveTex(host, [path.dirname(key), baseDir], inc.path);
      } else {
        target = await resolveTex(host, [baseDir, path.dirname(key)], inc.path);
      }
      if (target) {
        projectFile.children.push({ offset: inc.offset, path: path.normalize(target) });
        await visit(target, dir, key);
      } else project.unresolved.push({ file: key, target: inc.path, kind: 'include', line: inc.line, offset: inc.offset });
    }
  }

  await visit(root, rootDir);

  const graphicsPaths: string[] = [];
  for (const f of project.files) {
    graphicsPaths.push(...f.index.graphicsPaths);
    for (const bib of f.index.bibResources) {
      const target = bib.path.endsWith('.bib') ? bib.path : bib.path + '.bib';
      const full = path.resolve(rootDir, target);
      if (await host.exists(full)) {
        if (!project.bibFiles.includes(full)) project.bibFiles.push(full);
      } else {
        project.unresolved.push({ file: f.path, target: bib.path, kind: 'bibliography', line: bib.line, offset: bib.offset });
      }
    }
    if (f.index.documentClass) {
      const cls = path.resolve(rootDir, f.index.documentClass.name + '.cls');
      if (await host.exists(cls)) project.styleFiles.push(cls);
    }
    for (const pkg of f.index.packages) {
      const sty = path.resolve(rootDir, pkg.name + '.sty');
      if (!project.styleFiles.includes(sty) && (await host.exists(sty))) project.styleFiles.push(sty);
    }
  }

  const searchDirs = [rootDir, ...graphicsPaths.map((p) => path.resolve(rootDir, p))];
  for (const f of project.files) {
    for (const g of f.index.graphics) {
      const resolved = await resolveGraphic(host, searchDirs, g.path);
      project.graphics.push({ file: f.path, target: g.path, resolved, line: g.line, offset: g.offset });
      if (!resolved) project.unresolved.push({ file: f.path, target: g.path, kind: 'graphic', line: g.line, offset: g.offset });
    }
  }
  return project;
}

async function resolveTex(host: FileHost, dirs: string[], name: string): Promise<string | undefined> {
  for (const dir of dirs) {
    const base = path.resolve(dir, name);
    const candidates = path.extname(base) ? [base, base + '.tex'] : [base + '.tex', base];
    for (const c of candidates) {
      if (await host.exists(c)) return c;
    }
  }
  return undefined;
}

export async function resolveGraphic(host: FileHost, dirs: string[], name: string): Promise<string | undefined> {
  for (const dir of dirs) {
    const base = path.resolve(dir, name);
    if (path.extname(name) && (await host.exists(base))) return base;
    for (const ext of GRAPHIC_EXTENSIONS) {
      if (await host.exists(base + ext)) return base + ext;
    }
  }
  return undefined;
}

export interface RootCandidate {
  path: string;
  index: TexFileIndex;
}

/**
 * Picks the root document for `activeFile`.
 * Order: `% !TEX root` in the active file, the active file itself if it is a full document,
 * a candidate that includes the active file, then the only candidate.
 * Returns `undefined` + the candidates when the choice is ambiguous.
 */
export async function detectRoot(
  activeFile: string | undefined,
  candidates: RootCandidate[],
  host: FileHost,
): Promise<{ root?: string; reason: string; ambiguous?: string[] }> {
  if (activeFile) {
    const active = candidates.find((c) => c.path === activeFile);
    const magicRoot = active?.index.magic.root;
    if (magicRoot) {
      const target = path.resolve(path.dirname(activeFile), magicRoot);
      if (await host.exists(target)) return { root: target, reason: 'magic comment' };
    }
  }
  const roots = candidates.filter((c) => c.index.documentClass && c.index.hasBeginDocument);
  if (activeFile && roots.some((r) => r.path === activeFile)) return { root: activeFile, reason: 'active file' };

  if (activeFile) {
    const containing: string[] = [];
    for (const r of roots) {
      const project = await loadProject(r.path, host);
      if (project.files.some((f) => f.path === activeFile)) containing.push(r.path);
    }
    if (containing.length === 1) return { root: containing[0], reason: 'includes the active file' };
    if (containing.length > 1) return { reason: 'several roots include this file', ambiguous: containing };
  }
  if (roots.length === 1) return { root: roots[0].path, reason: 'only root in workspace' };
  if (roots.length === 0) return { reason: 'no file with \\documentclass and \\begin{document}' };
  // Prefer main.tex when it exists in a set of otherwise equal candidates.
  const main = roots.filter((r) => /(^|[\\/])main\.tex$/.test(r.path));
  if (main.length === 1) return { root: main[0].path, reason: 'main.tex' };
  return { reason: 'several root documents', ambiguous: roots.map((r) => r.path) };
}
