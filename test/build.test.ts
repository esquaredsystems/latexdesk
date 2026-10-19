// Runs real builds of the small thesis fixture: full, fast preview and partial.
// Skipped when latexmk is not installed.
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildRun } from '../src/build/runner';
import { BUILTIN_RECIPES, BUILTIN_TOOLS, previewTool } from '../src/build/recipes';
import { seedFromFullBuild } from '../src/build/outputs';
import { planExport, verifyExport, writeExport, PRESETS } from '../src/build/exporter';
import { loadProject } from '../src/core/project';
import { promises as fsp } from 'fs';

const hasLatexmk = (() => {
  try {
    execFileSync('latexmk', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function placeholders(dir: string, outDir: string) {
  return { DOC: 'main', DOCFILE: 'main', DOC_EXT: 'main.tex', DIR: dir, OUTDIR: outDir, PATHSEP: path.delimiter };
}

describe.skipIf(!hasLatexmk)('builds', () => {
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ls-build-'));
    cpSync(path.join(__dirname, 'fixtures', 'thesis'), dir, { recursive: true });
    const full = await new BuildRun({ recipe: BUILTIN_RECIPES[0], tools: BUILTIN_TOOLS, placeholders: placeholders(dir, dir) }).run();
    expect(full.ok).toBe(true);
  }, 120_000);

  it('fast preview writes a separate PDF with draft graphics', async () => {
    const outDir = path.join(dir, '.latexdesk', 'fast');
    seedFromFullBuild(dir, outDir, 'main');
    expect(existsSync(path.join(outDir, 'main.aux'))).toBe(true);
    const fullPdfTime = statSync(path.join(dir, 'main.pdf')).mtimeMs;

    const tool = previewTool('-pdf', '\\PassOptionsToPackage{draft}{graphicx}');
    const result = await new BuildRun({ recipe: { name: 'fast', tools: [tool.name] }, tools: [tool], placeholders: placeholders(dir, outDir) }).run();
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(outDir, 'main.pdf'))).toBe(true);
    expect(existsSync(path.join(outDir, 'main.synctex.gz'))).toBe(true);
    // In draft mode graphicx draws a frame with the file name instead of embedding the image.
    const hasImage = (pdf: string) => /\/Subtype\s*\/Image/.test(readFileSync(pdf).toString('latin1'));
    expect(hasImage(path.join(dir, 'main.pdf'))).toBe(true);
    expect(hasImage(path.join(outDir, 'main.pdf'))).toBe(false);
    // The full build's PDF is untouched.
    expect(statSync(path.join(dir, 'main.pdf')).mtimeMs).toBe(fullPdfTime);
  }, 120_000);

  it('partial build includes only the chosen chapter and keeps references', async () => {
    const outDir = path.join(dir, '.latexdesk', 'partial');
    seedFromFullBuild(dir, outDir, 'main');
    const tool = previewTool('-pdf', '\\includeonly{chapters/methodology}');
    const result = await new BuildRun({ recipe: { name: 'partial', tools: [tool.name] }, tools: [tool], placeholders: placeholders(dir, outDir) }).run();
    expect(result.ok).toBe(true);
    const log = readFileSync(path.join(outDir, 'main.log'), 'utf8');
    expect(log).toContain('methodology.tex');
    expect(log).not.toMatch(/chapters\/introduction\.tex/);
    expect(log).not.toMatch(/undefined references/);
  }, 120_000);

  it('exports a flattened, comment-free copy that compiles on its own', async () => {
    const host = { readFile: (f: string) => fsp.readFile(f, 'utf8').catch(() => undefined), exists: (f: string) => fsp.access(f).then(() => true, () => false) };
    const project = await loadProject(path.join(dir, 'main.tex'), host);
    const plan = planExport(project, dir, 'main', PRESETS.journal, 'journal');
    const targets = plan.files.map((f) => f.target);
    expect(targets).toContain('main.tex');
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toContain('main.bbl');
    expect(targets).toContain('figures/setup.png');
    // Chapters are inlined into main.tex, so they are not shipped separately.
    expect(targets.some((t) => t.startsWith('chapters/'))).toBe(false);
    const main = plan.files.find((f) => f.target === 'main.tex')!.content!;
    expect(main).not.toMatch(/\\include\{chapters/);
    expect(main).not.toMatch(/^%/m);
    expect(plan.checks.find((c) => c.message === '.bbl present')).toBeDefined();

    const zip = path.join(dir, 'export.zip');
    await writeExport(plan, zip, 'zip');
    expect(statSync(zip).size).toBeGreaterThan(1000);

    const verified = await verifyExport(plan, 'main.tex', 'main');
    expect(verified.message).toBe('The exported copy compiles.');
    expect(verified.ok).toBe(true);
  }, 180_000);
});
