// Generated files: listing, safe cleaning and pre-build snapshots of an existing PDF.
import * as fs from 'fs';
import * as path from 'path';

/** Files named after the job in the output directory whose extension is in `extensions`. */
export function listGenerated(outDir: string, jobName: string, extensions: string[]): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(outDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(jobName + '.') && extensions.some((ext) => n === jobName + ext))
    .map((n) => path.join(outDir, n));
}

/** Every file that a build writes next to the PDF, for the Output Files view. */
export function listOutputs(outDir: string, jobName: string): string[] {
  const known = ['.pdf', '.log', '.synctex.gz', '.aux', '.bbl', '.blg', '.idx', '.ind', '.ilg', '.toc', '.lof', '.lot', '.out', '.fls', '.fdb_latexmk', '.bcf', '.run.xml'];
  return listGenerated(outDir, jobName, known);
}

/**
 * Removes generated files. Refuses anything that is not an auxiliary extension, so source
 * files (.tex, .bib, .cls, .sty, images) can never be deleted by a clean.
 */
export function cleanFiles(files: string[]): { removed: string[]; refused: string[] } {
  const protectedExt = /\.(tex|bib|cls|sty|bst|png|jpe?g|eps|svg|ltx|dtx|ins)$/i;
  const removed: string[] = [];
  const refused: string[] = [];
  for (const f of files) {
    if (protectedExt.test(f)) {
      refused.push(f);
      continue;
    }
    try {
      fs.unlinkSync(f);
      removed.push(f);
    } catch {
      refused.push(f);
    }
  }
  return { removed, refused };
}

/**
 * Copies an existing PDF (and its SyncTeX file) into `<dir>/.latexdesk/snapshots/<time>/`
 * before the first build overwrites it. Returns the snapshot folder, or undefined if there was nothing to keep.
 */
export function snapshotExistingPdf(outDir: string, jobName: string, snapshotRoot: string): string | undefined {
  const pdf = path.join(outDir, jobName + '.pdf');
  if (!fs.existsSync(pdf)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(snapshotRoot, '.latexdesk', 'snapshots', stamp);
  fs.mkdirSync(target, { recursive: true });
  for (const ext of ['.pdf', '.synctex.gz']) {
    const src = path.join(outDir, jobName + ext);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, jobName + ext));
  }
  return target;
}

/**
 * \include writes one .aux file per included file next to the main .aux, in the same
 * sub-folder as the source. With a separate output directory those sub-folders must exist,
 * or LaTeX stops with "I can't write on file chapters/intro.aux".
 */
export function prepareOutDir(outDir: string, rootDir: string, sourceFiles: string[]) {
  fs.mkdirSync(outDir, { recursive: true });
  if (path.resolve(outDir) === path.resolve(rootDir)) return;
  for (const file of sourceFiles) {
    const rel = path.relative(rootDir, path.dirname(file));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.mkdirSync(path.join(outDir, rel), { recursive: true });
  }
}

/**
 * Seeds an empty preview output folder with the auxiliary files of the last full build, so the
 * first fast or partial build starts with resolved references, bibliography and index. Once the
 * folder has its own files it is left alone: copying again would make latexmk see changed files
 * and redo every pass.
 */
export function seedFromFullBuild(fullOutDir: string, previewOutDir: string, jobName: string) {
  const fullAux = path.join(fullOutDir, jobName + '.aux');
  if (!fs.existsSync(fullAux) || fs.existsSync(path.join(previewOutDir, jobName + '.aux'))) return;
  const copy = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = path.join(rel, entry.name);
      // Never descend into our own folder or other build folders.
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && rel.split(path.sep).length < 3) copy(dir, relPath);
      } else if (/\.(aux|bbl|ind|toc|lof|lot|loa|out|nls)$/.test(entry.name)) {
        fs.mkdirSync(path.join(previewOutDir, rel), { recursive: true });
        fs.copyFileSync(path.join(dir, relPath), path.join(previewOutDir, relPath));
      }
    }
  };
  fs.mkdirSync(previewOutDir, { recursive: true });
  copy(fullOutDir, '');
}

/** Creates `<dir>/.latexdesk/` with a .gitignore so build previews and snapshots are not committed. */
export function ensureStudioDir(rootDir: string): string {
  const dir = path.join(rootDir, '.latexdesk');
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'fast/\npartial/\nsnapshots/\nhistory/\ndiff/\nexport/\n');
  return dir;
}
