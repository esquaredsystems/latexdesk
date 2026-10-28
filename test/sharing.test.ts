// Tests for the duplicate package check, the source ZIP, the watermark and the template library.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { parseTex } from '../src/core/texParser';
import { findDuplicatePackages, PackageLoad, removePackageEdit } from '../src/core/packages';
import { listSourceFiles } from '../src/build/exporter';
import { UnsupportedTextError, watermarkPdf } from '../src/build/watermark';
import { findMainFile, indexTemplates, parseCatalog, planExtraction, searchTemplates, Template } from '../src/core/templates';
import { extractProject } from '../src/build/templateFiles';

const loads = (file: string, text: string): PackageLoad[] => parseTex(text).packages.map((p) => ({ file, name: p.name, offset: p.offset, line: p.line, options: p.options }));
const apply = (text: string, e: { start: number; end: number; text: string }) => text.slice(0, e.start) + e.text + text.slice(e.end);

describe('duplicate packages (TS-41)', () => {
  const text = '\\usepackage{amsmath,graphicx}\n\\usepackage[T1]{fontenc}\n% \\usepackage{hyperref}\n\\usepackage{hyperref}\n\\usepackage{amssymb, graphicx}\n\\usepackage[utf8]{fontenc}\n';

  it('reports every load after the first, and option clashes', () => {
    const dups = findDuplicatePackages(loads('main.tex', text));
    expect(dups.map((d) => [d.name, d.line, d.first.line, d.optionClash])).toEqual([
      ['graphicx', 4, 0, false],
      ['fontenc', 5, 1, true],
    ]);
  });

  it('finds a package loaded again in another file', () => {
    const all = [...loads('main.tex', '\\usepackage{xcolor}\n'), ...loads('chap.tex', '\\usepackage[table]{xcolor}\n')];
    const [dup] = findDuplicatePackages(all);
    expect(dup.file).toBe('chap.tex');
    expect(dup.optionClash).toBe(true);
    // Loading again without options never clashes.
    expect(findDuplicatePackages([...loads('a', '\\usepackage[table]{xcolor}'), ...loads('b', '\\usepackage{xcolor}')])[0].optionClash).toBe(false);
  });

  it('removes the repeated name, or the whole line', () => {
    const [graphicx, fontenc] = findDuplicatePackages(loads('main.tex', text));
    const once = apply(text, removePackageEdit(text, graphicx.offset)!);
    expect(once).toContain('\\usepackage{amssymb}\n');
    const twice = apply(text, removePackageEdit(text, fontenc.offset)!);
    expect(twice).not.toContain('[utf8]');
    expect(twice.split('\n')).toHaveLength(text.split('\n').length - 1);
    const first = '\\usepackage{graphicx, amsmath}';
    expect(apply(first, removePackageEdit(first, first.indexOf('graphicx'))!)).toBe('\\usepackage{amsmath}');
    const dated = 'x \\usepackage{a}[2020/01/01] y';
    expect(apply(dated, removePackageEdit(dated, dated.indexOf('a}'))!)).toBe('x  y');
  });
});

describe('source ZIP selection (OL-48)', () => {
  it('keeps sources and figures, leaves out build output and compiled PDFs', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ld-src-'));
    const files: Record<string, string> = {
      'main.tex': 'x',
      'main.pdf': 'compiled',
      'main.aux': 'x',
      'main.synctex.gz': 'x',
      'main.fdb_latexmk': 'x',
      'main-blx.bib': 'x',
      'main-watermarked.pdf': 'x',
      'refs.bib': 'x',
      'chapters/one.tex': 'x',
      'chapters/one.pdf': 'compiled chapter',
      'figures/plot.pdf': 'figure',
      'figures/photo.png': 'figure',
      'style/my.sty': 'x',
      'data/table.csv': 'x',
      'old-source.zip': 'x',
      '.DS_Store': 'x',
      'notes.tex~': 'x',
      '.git/config': 'x',
      '.vscode/settings.json': 'x',
      '.latexdesk/history/a': 'x',
      '_minted-main/x.pygtex': 'x',
      'build/main.log': 'x',
      'build/other.pdf': 'x',
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    const outside = mkdtempSync(path.join(os.tmpdir(), 'ld-out-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'x');
    symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));

    const { files: found, notes } = listSourceFiles(dir, path.join(dir, 'build'));
    const rel = found.map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();
    expect(rel).toEqual(['chapters/one.tex', 'data/table.csv', 'figures/photo.png', 'figures/plot.pdf', 'main.tex', 'refs.bib', 'style/my.sty']);
    expect(notes.join(' ')).toMatch(/compiled PDF/);
    expect(notes.join(' ')).toMatch(/1 link/);
  });
});

async function samplePdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage(i === 1 ? [842, 595] : [595, 842]);
  return pdf.save();
}

async function pageTexts(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, verbosity: 0 }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }
  return texts;
}

describe('watermark (OL-49)', () => {
  it('puts the text on every page and keeps the pages', async () => {
    const input = await samplePdf(3);
    for (const placement of ['diagonal', 'top', 'bottom'] as const) {
      const out = await watermarkPdf(input, { text: 'DRAFT', placement, opacity: 0.15 });
      const doc = await PDFDocument.load(out);
      expect(doc.getPageCount()).toBe(3);
      expect(doc.getPage(1).getSize()).toEqual({ width: 842, height: 595 });
      expect(await pageTexts(out)).toEqual(['DRAFT', 'DRAFT', 'DRAFT']);
    }
  });

  it('refuses characters the standard font cannot show', async () => {
    await expect(watermarkPdf(await samplePdf(1), { text: 'مسودہ', placement: 'diagonal', opacity: 0.2 })).rejects.toBeInstanceOf(UnsupportedTextError);
  });
});

describe('template catalog (OL-51, OL-53)', () => {
  const catalog = parseCatalog({
    version: 1,
    templates: [
      { id: 'ieee-conference', name: 'IEEE Conference Paper', type: 'conference', publisher: 'IEEE', tags: ['engineering'], filename: 'ieee-conference.zip', extra: 1 },
      { id: 'springer-lncs', name: 'Lecture Notes in Computer Science', type: 'Conference', publisher: 'Springer', tags: ['computer science'] },
      { id: 'ieee-journal', name: 'IEEE Transactions Journal', type: 'journal', publisher: 'IEEE', description: 'Two-column journal article.' },
      { id: 'zurich', name: 'Thèse de doctorat', type: 'thesis', publisher: 'Université de Zürich' },
      { id: 'ieee-journal', name: 'Repeated id', type: 'journal' },
      { id: 'Bad Id', name: 'x', type: 'journal' },
      { name: 'No id', type: 'journal' },
      { id: 'odd-type', name: 'Odd', type: 'flyer' },
    ],
  });
  const index = indexTemplates(catalog.templates);
  const ids = (q: string) => searchTemplates(index, q).map((r) => r.template.id);

  it('skips invalid and repeated entries and keeps the catalog order', () => {
    expect(catalog.templates.map((t) => t.id)).toEqual(['ieee-conference', 'springer-lncs', 'ieee-journal', 'zurich', 'odd-type']);
    expect(catalog.skipped).toBe(3);
    expect(catalog.templates[1].type).toBe('conference');
    expect(catalog.templates[4].type).toBe('other');
    expect(parseCatalog([{ id: 'a', name: 'A', type: 'cv' }]).templates).toHaveLength(1);
  });

  it('requires every word, matches prefixes and accents, ranks the name first', () => {
    expect(ids('ieee')).toEqual(['ieee-conference', 'ieee-journal']);
    expect(ids('ieee journal')).toEqual(['ieee-journal']);
    expect(ids('spring')).toEqual(['springer-lncs']);
    expect(ids('zurich')).toEqual(['zurich']);
    expect(ids('conference')[0]).toBe('ieee-conference');
    expect(ids('two-column')).toEqual(['ieee-journal']);
    expect(ids('nothing here')).toEqual([]);
    expect(ids('')).toHaveLength(5);
  });

  it('searches 10,000 templates within the budget', () => {
    const big: Template[] = [];
    const words = ['physics', 'biology', 'economics', 'chemistry', 'law', 'medicine', 'history', 'computing'];
    for (let i = 0; i < 10000; i++) {
      big.push({ id: `t${i}`, name: `Journal of ${words[i % 8]} ${i}`, type: 'journal', publisher: `Publisher ${i % 50}`, description: 'A long description of the journal and its house style. '.repeat(3), tags: [words[(i + 3) % 8]], requires: [], order: i });
    }
    const bigIndex = indexTemplates(big);
    searchTemplates(bigIndex, 'warm up');
    const started = performance.now();
    const results = searchTemplates(bigIndex, 'journal phys publisher 7');
    expect(performance.now() - started).toBeLessThan(50);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('template extraction (OL-55)', () => {
  it('rejects unsafe paths and drops a single top folder and macOS metadata', () => {
    expect(planExtraction(['../evil.tex']).error).toMatch(/outside/);
    expect(planExtraction(['/etc/passwd']).error).toMatch(/absolute/);
    expect(planExtraction(['C:\\x.tex']).error).toMatch(/absolute/);
    const plan = planExtraction(['kit/', 'kit/main.tex', 'kit/fig/a.png', '__MACOSX/kit/._main.tex', 'kit/._main.tex', 'kit/.DS_Store']);
    expect(plan.files.map((f) => f.target)).toEqual(['main.tex', 'fig/a.png']);
    expect(planExtraction(['a.tex', 'fig/b.png']).files.map((f) => f.target)).toEqual(['a.tex', 'fig/b.png']);
  });

  it('finds the root document', () => {
    const doc = '\\documentclass{article}\n\\begin{document}\n\\end{document}';
    expect(findMainFile([{ path: 'chap.tex', text: '\\section{A}' }, { path: 'paper.tex', text: doc }])).toBe('paper.tex');
    expect(findMainFile([{ path: 'paper.tex', text: doc }, { path: 'main.tex', text: doc }, { path: 'domain.tex', text: doc }])).toBe('main.tex');
    expect(findMainFile([{ path: 'a.tex', text: '% \\documentclass{x}\n% \\begin{document}' }])).toBeUndefined();
    expect(findMainFile([{ path: 'paper.tex', text: doc }], 'paper.tex')).toBe('paper.tex');
  });

  it('extracts a ZIP into a new folder', async () => {
    const zip = new JSZip();
    zip.file('kit/main.tex', '\\documentclass{article}\\begin{document}x\\end{document}');
    zip.file('kit/refs.bib', '');
    zip.file('__MACOSX/kit/._main.tex', 'junk');
    const data = await zip.generateAsync({ type: 'uint8array' });
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'ld-tpl-')), 'paper');
    expect(await extractProject(data, dir)).toBe('main.tex');
    expect(readdirSync(dir).sort()).toEqual(['main.tex', 'refs.bib']);
    expect(readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('documentclass');
  });
});
