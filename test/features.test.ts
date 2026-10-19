// Tests for history snapshots, rename helpers and the .bib edits added for the entry form and triage.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/build/history';
import { findCommandUses, findEnvironmentUses } from '../src/core/texParser';
import { parseBib } from '../src/core/bibParser';
import { applyEdits, changeType, suppressEdit } from '../src/core/bibEdit';
import { scanBib } from '../src/core/bibScanner';

describe('history store', () => {
  function project() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ls-history-'));
    mkdirSync(path.join(dir, 'chapters'));
    writeFileSync(path.join(dir, 'main.tex'), 'main v1\n');
    writeFileSync(path.join(dir, 'chapters', 'one.tex'), 'one v1\r\n');
    return { dir, files: [path.join(dir, 'main.tex'), path.join(dir, 'chapters', 'one.tex')] };
  }

  it('skips unchanged snapshots, restores byte for byte and keeps labelled versions', () => {
    const { dir, files } = project();
    const store = new HistoryStore(dir);
    const first = store.take(files, 'build')!;
    expect(first.files['chapters/one.tex']).toBeDefined();
    expect(store.take(files, 'build')).toBeUndefined();

    writeFileSync(files[1], 'one v2\r\n');
    expect(store.changedFiles(first)).toEqual(['chapters/one.tex']);
    store.take(files, 'build');
    store.restore(first, ['chapters/one.tex']);
    expect(readFileSync(files[1], 'utf8')).toBe('one v1\r\n');

    store.setLabel(first.id, 'Submitted v1');
    for (let i = 0; i < 5; i++) {
      writeFileSync(files[0], `main v${i + 2}\n`);
      store.take(files, 'build', undefined, { maxSnapshots: 2 });
    }
    const list = store.list();
    expect(list.filter((s) => !s.label)).toHaveLength(2);
    expect(list.find((s) => s.label === 'Submitted v1')).toBeDefined();
    // Objects of pruned snapshots are removed, those still referenced stay readable.
    expect(store.read(list[0], 'main.tex')?.toString()).toBe('main v1\n');
  });

  it('starts fresh when the index is damaged', () => {
    const { dir } = project();
    mkdirSync(path.join(dir, '.latexdesk', 'history'), { recursive: true });
    writeFileSync(path.join(dir, '.latexdesk', 'history', 'index.json'), '{ not json');
    expect(new HistoryStore(dir).list()).toEqual([]);
  });
});

describe('rename helpers', () => {
  it('finds command uses but not longer names, comments or verbatim', () => {
    const text = '\\newcommand{\\R}{\\mathbb{R}}\n$x \\in \\R$ and \\Rset % \\R in a comment\n\\begin{verbatim}\\R\\end{verbatim}\n\\R^2';
    const uses = findCommandUses(text, 'R');
    expect(uses.map((o) => text.slice(o, o + 3))).toEqual(['\\R}', '\\R$', '\\R^']);
  });

  it('finds environment names in begin, end and definitions', () => {
    const text = '\\newtheorem{claim}{Claim}\n\\begin{claim}x\\end{claim}\n\\begin{claims}\\end{claims}';
    const uses = findEnvironmentUses(text, 'claim');
    expect(uses).toHaveLength(3);
    for (const o of uses) expect(text.slice(o, o + 6)).toBe('claim}');
  });
});

describe('bib edits', () => {
  const text = '@Article{knuth84,\r\n  author = {Knuth, D.},\r\n  title = {Literate Programming},\r\n}\r\n';

  it('changes the entry type keeping its capitalisation', () => {
    const file = parseBib(text);
    const out = applyEdits(text, [changeType(text, file.entries[0], 'book')!]);
    expect(out.startsWith('@Book{knuth84,')).toBe(true);
    expect(out.slice(6)).toBe(text.slice(9));
  });

  it('suppresses rules with one comment line per rule, using the file line ending', () => {
    let current = text;
    for (const code of ['bib/missing-required', 'bib/missing-doi']) {
      const entry = parseBib(current).entries[0];
      current = applyEdits(current, [suppressEdit(current, entry, code)]);
    }
    expect(current.startsWith('% bib-ignore: missing-required\r\n% bib-ignore: missing-doi\r\n@Article')).toBe(true);
    const result = scanBib(parseBib(current), current, { dialect: 'bibtex', profile: 'standard' });
    expect(result.findings.map((f) => f.code)).not.toContain('bib/missing-required');
    expect(result.findings.map((f) => f.code)).not.toContain('bib/missing-doi');
  });
});

describe('prose extraction for spell checking', () => {
  it('keeps prose and skips commands, math, labels, citations, comments and accents', async () => {
    const { proseWords } = await import('../src/core/prose');
    const text = [
      '\\section{Introducton}\\label{sec:intro-labl}',
      'We folow the work of~\\citep[p.~3]{smith2019xyz} and M\\"uller with $\\alphaa + x_{iii}$.',
      '% a commment here',
      '\\begin{equation} wrongg \\end{equation}',
      '\\includegraphics[width=0.5\\linewidth]{figs/setupp} See \\url{http://exmple.org}. NASA uses hy\\-phenation.',
      '\\begin{tabular}{lcr} cell & text \\end{tabular}',
    ].join('\n');
    const words = proseWords(text).map((w) => w.word);
    expect(words).toContain('Introducton');
    expect(words).toContain('folow');
    for (const skipped of ['labl', 'smith', 'xyz', 'alphaa', 'iii', 'commment', 'wrongg', 'setupp', 'exmple', 'NASA', 'uller', 'phenation', 'lcr', 'linewidth']) {
      expect(words).not.toContain(skipped);
    }
    const w = proseWords(text).find((x) => x.word === 'folow')!;
    expect(text.slice(w.offset, w.offset + 5)).toBe('folow');
  });
});

describe('table wizard model', () => {
  it('parses an existing booktabs table and regenerates equivalent source', async () => {
    const { parseTable, generateTable } = await import('../src/core/table');
    const source = [
      '\\begin{table}[ht]',
      '  \\centering',
      '  \\begin{tabular}{l*{2}{c}p{3cm}}',
      '    \\toprule',
      '    Site & n & Mean & Notes \\\\',
      '    \\midrule',
      '    Leeds & 120 & 4.2 & baseline \\\\ % a comment & with ampersand',
      '    Hull & 88 & $\\mu$ & {a & b} \\\\[2pt]',
      '    \\bottomrule',
      '  \\end{tabular}',
      '  \\caption{Participants per site.}\\label{tab:sites}',
      '\\end{table}',
    ].join('\n');
    const model = parseTable(source);
    if ('error' in model) throw new Error(model.error);
    expect(model.columns).toEqual(['l', 'c', 'c', 'p{3cm}']);
    expect(model.rows).toEqual([
      ['Site', 'n', 'Mean', 'Notes'],
      ['Leeds', '120', '4.2', 'baseline'],
      ['Hull', '88', '$\\mu$', '{a & b}'],
    ]);
    expect(model.booktabs && model.header && model.float).toBe(true);
    expect(model.caption).toBe('Participants per site.');
    expect(model.label).toBe('tab:sites');
    expect(model.placement).toBe('ht');
    const again = parseTable(generateTable(model));
    expect(again).toEqual(model);
  });

  it('refuses tables it cannot show faithfully', async () => {
    const { parseTable } = await import('../src/core/table');
    expect(parseTable('\\begin{tabular}{ll}\\multicolumn{2}{c}{x}\\\\\\end{tabular}')).toHaveProperty('error');
  });

  it('reads spreadsheet clipboard text and escapes special characters', async () => {
    const { parseDelimited } = await import('../src/core/table');
    expect(parseDelimited('Name\tShare\nA&B\t50%\n"x, y"\t3')).toEqual([
      ['Name', 'Share'],
      ['A\\&B', '50\\%'],
      ['x, y', '3'],
    ]);
    expect(parseDelimited('a,b\n"x, y",2')).toEqual([
      ['a', 'b'],
      ['x, y', '2'],
    ]);
  });
});
