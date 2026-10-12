// Tests for the text operations behind the editor toolbars.
import { describe, expect, it } from 'vitest';
import { alignLines, changeSize, toggleCommand, Replacement } from '../src/core/formatting';
import { tableEdit } from '../src/core/table';

const apply = (text: string, r: Replacement) => text.slice(0, r.start) + r.text + text.slice(r.end);
const applyAll = (text: string, edits: { start: number; end: number; text: string }[]) =>
  [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);

describe('toggleCommand', () => {
  it('wraps, and unwraps from the argument or the whole command', () => {
    const text = 'a word here';
    const wrapped = toggleCommand(text, 2, 6, 'textbf');
    const t2 = apply(text, wrapped);
    expect(t2).toBe('a \\textbf{word} here');
    expect(t2.slice(wrapped.selectStart, wrapped.selectEnd)).toBe('word');
    expect(apply(t2, toggleCommand(t2, wrapped.selectStart, wrapped.selectEnd, 'textbf'))).toBe(text);
    expect(apply(t2, toggleCommand(t2, 2, 15, 'textbf'))).toBe(text);
  });
  it('nests a different command instead of removing', () => {
    const t = 'a \\textbf{word}';
    expect(apply(t, toggleCommand(t, 10, 14, 'textit'))).toBe('a \\textbf{\\textit{word}}');
  });
});

describe('changeSize', () => {
  it('steps through the size commands and back to normal', () => {
    let text = 'Title';
    let r = changeSize(text, 0, 5, 1);
    text = apply(text, r);
    expect(text).toBe('{\\large Title}');
    r = changeSize(text, r.selectStart, r.selectEnd, 1);
    text = apply(text, r);
    expect(text).toBe('{\\Large Title}');
    r = changeSize(text, r.selectStart, r.selectEnd, -1);
    text = apply(text, r);
    r = changeSize(text, r.selectStart, r.selectEnd, -1);
    text = apply(text, r);
    expect(text).toBe('Title');
    expect(apply('x', changeSize('x', 0, 1, -1))).toBe('{\\small x}');
  });
});

describe('alignLines', () => {
  it('wraps lines, switches the environment, and removes it when chosen again', () => {
    let text = 'before\nSome text\nafter\n';
    const start = 7;
    const end = 17;
    let r = alignLines(text, start, end, 'center');
    text = apply(text, r);
    expect(text).toBe('before\n\\begin{center}\nSome text\n\\end{center}\nafter\n');
    r = alignLines(text, r.selectStart, r.selectEnd, 'flushright');
    text = apply(text, r);
    expect(text).toBe('before\n\\begin{flushright}\nSome text\n\\end{flushright}\nafter\n');
    r = alignLines(text, r.selectStart, r.selectEnd, 'flushright');
    expect(apply(text, r)).toBe('before\nSome text\nafter\n');
  });
});

describe('tableEdit', () => {
  const table = ['\\begin{tabular}{|l|c|}', '  \\hline', '  A & B \\\\', '  \\hline', '  a & b \\\\', '  c & d \\\\', '  \\hline', '\\end{tabular}'].join('\n');
  const at = (s: string) => table.indexOf(s) + 1;

  it('adds a row after the current one, with the right number of cells', () => {
    const edits = tableEdit(table, at('a & b'), 'addRow');
    if ('error' in edits) throw new Error(edits.error);
    expect(applyAll(table, edits)).toContain('  a & b \\\\\n  & \\\\\n  c & d');
  });

  it('deletes the current row and its line', () => {
    const edits = tableEdit(table, at('c & d'), 'deleteRow');
    if ('error' in edits) throw new Error(edits.error);
    expect(applyAll(table, edits)).toBe(table.replace('  c & d \\\\\n', ''));
  });

  it('adds a column after the current cell, in every row and in the spec', () => {
    const edits = tableEdit(table, at('a & b'), 'addColumn');
    if ('error' in edits) throw new Error(edits.error);
    const out = applyAll(table, edits);
    expect(out).toContain('{|l|l|c|}');
    expect(out).toContain('A &  & B');
    expect(out).toContain('c &  & d');
  });

  it('deletes the current column everywhere', () => {
    const edits = tableEdit(table, table.indexOf('d \\\\'), 'deleteColumn');
    if ('error' in edits) throw new Error(edits.error);
    const out = applyAll(table, edits);
    expect(out).toContain('{|l|}');
    expect(out).toContain('  A  \\\\');
    expect(out).toContain('  c  \\\\');
  });

  it('explains when it cannot help', () => {
    expect(tableEdit('no table here', 3, 'addRow')).toHaveProperty('error');
    const multi = '\\begin{tabular}{ll}\\multicolumn{2}{c}{x}\\\\ a & b\\\\\\end{tabular}';
    expect(tableEdit(multi, multi.indexOf('a &'), 'addColumn')).toHaveProperty('error');
  });
});
