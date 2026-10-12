// Table model for the table wizard: parse an existing tabular back into a grid, generate
// LaTeX from the grid, and read CSV/TSV pasted from a spreadsheet.
import Papa from 'papaparse';

export type TableEnv = 'tabular' | 'tabularx' | 'longtable';

export interface TableModel {
  env: TableEnv;
  /** One column type per column: l, c, r, p{3cm}, X, S ... */
  columns: string[];
  /** Cell contents as LaTeX source. */
  rows: string[][];
  booktabs: boolean;
  /** First row is a header (followed by \midrule or \hline). */
  header: boolean;
  /** Wrap in a floating table environment with caption and label. */
  float: boolean;
  caption: string;
  label: string;
  placement: string;
  /** Width argument of tabularx, e.g. \linewidth. */
  width: string;
}

export function emptyTable(rows = 3, cols = 3): TableModel {
  return {
    env: 'tabular',
    columns: Array(cols).fill('l'),
    rows: Array.from({ length: rows }, () => Array(cols).fill('')),
    booktabs: true,
    header: true,
    float: true,
    caption: '',
    label: 'tab:',
    placement: 't',
    width: '\\linewidth',
  };
}

/** Splits a column spec like `|l|c|p{3cm}|` or `lS[table-format=2.1]r` into column types. */
export function splitColumnSpec(spec: string): string[] {
  const cols: string[] = [];
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (/\s|\|/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '@' || ch === '!' || ch === '>' || ch === '<') {
      // Inter-column material and >{..} decorations belong to no column of their own; skip them.
      i = skipGroup(spec, i + 1);
      continue;
    }
    if (ch === '*') {
      // *{3}{c} -> c c c
      const countEnd = skipGroup(spec, i + 1);
      const count = parseInt(spec.slice(i + 2, countEnd - 1), 10) || 1;
      const bodyEnd = skipGroup(spec, countEnd);
      const body = splitColumnSpec(spec.slice(countEnd + 1, bodyEnd - 1));
      for (let k = 0; k < count; k++) cols.push(...body);
      i = bodyEnd;
      continue;
    }
    let end = i + 1;
    // Column types with an argument: p{..}, m{..}, b{..}, S[..], w{..}{..}
    while (spec[end] === '{' || spec[end] === '[') end = skipGroup(spec, end);
    cols.push(spec.slice(i, end));
    i = end;
  }
  return cols;
}

function skipGroup(s: string, open: number): number {
  const opener = s[open];
  const closer = opener === '[' ? ']' : '}';
  if (opener !== '{' && opener !== '[') return open + 1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === opener) depth++;
    else if (s[i] === closer && --depth === 0) return i + 1;
  }
  return s.length;
}

const RULE = /^\s*\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(\([^)]*\))?\{[^}]*\})\s*/;

/**
 * Parses LaTeX table source (a tabular, optionally inside a table float) into a model.
 * Returns an error message instead when the table uses constructs the grid cannot show
 * faithfully, so the wizard never loses content.
 */
export function parseTable(source: string): TableModel | { error: string } {
  const begin = /\\begin\{(tabular|tabularx|longtable)\}/.exec(source);
  if (!begin) return { error: 'No tabular, tabularx or longtable environment found.' };
  const env = begin[1] as TableEnv;
  let pos = begin.index + begin[0].length;
  let width = '\\linewidth';
  if (env === 'tabularx') {
    const end = skipGroup(source, pos);
    width = source.slice(pos + 1, end - 1);
    pos = end;
  }
  while (source[pos] === '[') pos = skipGroup(source, pos);
  if (source[pos] !== '{') return { error: 'Missing column specification.' };
  const specEnd = skipGroup(source, pos);
  const columns = splitColumnSpec(source.slice(pos + 1, specEnd - 1));
  const endTag = source.indexOf(`\\end{${env}}`, specEnd);
  if (endTag < 0) return { error: `\\end{${env}} not found.` };
  // Comments are dropped: an & or \\ inside a comment must not split cells.
  const body = source.slice(specEnd, endTag).replace(/(^|[^\\])%.*$/gm, '$1');
  if (/\\multirow|\\multicolumn|\\begin\{(tabular|array)/.test(body)) {
    return { error: 'This table uses \\multicolumn, \\multirow or a nested table. Edit it in the source so nothing is lost.' };
  }

  const rows: string[][] = [];
  const booktabs = /\\(toprule|midrule|bottomrule)/.test(body);
  let header = false;
  for (let raw of splitRows(body)) {
    let sawRule = false;
    for (let m = RULE.exec(raw); m; m = RULE.exec(raw)) {
      raw = raw.slice(m[0].length);
      sawRule = true;
    }
    if (sawRule && rows.length === 1) header = true;
    if (!raw.trim()) continue;
    rows.push(splitCells(raw).map((c) => c.trim()));
  }
  const cols = Math.max(columns.length, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < cols) r.push('');
  while (columns.length < cols) columns.push('l');

  const caption = /\\caption\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(source)?.[1] ?? '';
  const label = /\\label\{([^}]*)\}/.exec(source)?.[1] ?? '';
  const float = /\\begin\{table\*?\}/.test(source);
  const placement = /\\begin\{table\*?\}\[([^\]]*)\]/.exec(source)?.[1] ?? 't';
  return { env, columns, rows, booktabs, header, float, caption, label, placement, width };
}

/** Splits a tabular body at `\\` row ends that are not inside braces. */
function splitRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '\\' && body[i + 1] === '\\' && depth === 0) {
      rows.push(body.slice(start, i));
      i++;
      // Skip an optional row-spacing argument: \\[2pt]
      if (body[i + 1] === '[') i = skipGroup(body, i + 1) - 1;
      start = i + 1;
    } else if (ch === '\\') i++;
  }
  rows.push(body.slice(start));
  return rows;
}

function splitCells(row: string): string[] {
  const cells: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\') i++;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '&' && depth === 0) {
      cells.push(row.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(row.slice(start));
  return cells;
}

/** Generates LaTeX for the model, using `eol` as line ending. */
export function generateTable(t: TableModel, eol = '\n'): string {
  const lines: string[] = [];
  const indent = t.float ? '  ' : '';
  if (t.float && t.env !== 'longtable') {
    lines.push(`\\begin{table}${t.placement ? `[${t.placement}]` : ''}`, '  \\centering');
  }
  const spec = t.columns.join(t.booktabs ? '' : '|');
  const open = t.env === 'tabularx' ? `\\begin{tabularx}{${t.width}}{${spec}}` : `\\begin{${t.env}}{${t.booktabs ? spec : `|${spec}|`}}`;
  lines.push(indent + open);
  const top = t.booktabs ? '\\toprule' : '\\hline';
  const mid = t.booktabs ? '\\midrule' : '\\hline';
  const bottom = t.booktabs ? '\\bottomrule' : '\\hline';
  lines.push(indent + '  ' + top);
  t.rows.forEach((row, i) => {
    lines.push(indent + '  ' + row.join(' & ') + ' \\\\');
    if (i === 0 && t.header && t.rows.length > 1) lines.push(indent + '  ' + mid);
  });
  lines.push(indent + '  ' + bottom);
  if (t.env === 'longtable' && (t.caption || t.label)) lines.push(`  \\caption{${t.caption}}${t.label ? `\\label{${t.label}}` : ''}`);
  lines.push(indent + `\\end{${t.env}}`);
  if (t.float && t.env !== 'longtable') {
    if (t.caption || t.label) lines.push(`  \\caption{${t.caption}}${t.label && t.label !== 'tab:' ? `\\label{${t.label}}` : ''}`);
    lines.push('\\end{table}');
  }
  return lines.join(eol);
}

/** Packages a model needs, for the "add \usepackage" confirmation. */
export function requiredPackages(t: TableModel): string[] {
  const pkgs: string[] = [];
  if (t.booktabs) pkgs.push('booktabs');
  if (t.env === 'tabularx') pkgs.push('tabularx');
  if (t.env === 'longtable') pkgs.push('longtable');
  if (t.columns.some((c) => c.startsWith('S'))) pkgs.push('siunitx');
  if (t.columns.some((c) => /^[mb]\{/.test(c))) pkgs.push('array');
  return pkgs;
}

/** Escapes characters that are special in LaTeX, for data that comes from a spreadsheet. */
export function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/** Reads CSV or TSV text (as copied from a spreadsheet) into rows of escaped cells. */
export function parseDelimited(text: string): string[][] {
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true, delimiter: text.includes('\t') ? '\t' : '' });
  const rows = result.data.map((r) => r.map((c) => escapeLatex(c.trim())));
  const cols = Math.max(0, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < cols) r.push('');
  return rows;
}

/** Turns grid rows back into CSV (cells are written as their LaTeX source). */
export function toCsv(rows: string[][]): string {
  return Papa.unparse(rows);
}

// ---------------------------------------------------------------------------------------------
// Row and column operations on the table under the cursor (toolbar buttons). They work directly
// on the source, so everything in the table that is not touched stays as it was.

export type TableOp = 'addRow' | 'deleteRow' | 'addColumn' | 'deleteColumn';

interface RowSpan {
  /** Where the row's cells begin (after leading whitespace and \hline-style rules). */
  contentStart: number;
  /** End of the last cell (before trailing whitespace and the \\). */
  contentEnd: number;
  /** Offset just after the row's `\\` (and its optional [..]), or contentEnd for an unended row. */
  after: number;
  ended: boolean;
  /** Offsets of the `&` separators. */
  separators: number[];
}

/** Returns the edits for one operation, or a message explaining why it cannot be done here. */
export function tableEdit(text: string, offset: number, op: TableOp, eol = '\n'): { start: number; end: number; text: string }[] | { error: string } {
  const table = enclosingTable(text, offset);
  if (!table) return { error: 'Place the cursor inside a tabular, tabularx, longtable or array.' };
  const rows = tableRows(text, table.bodyStart, table.bodyEnd).filter((r) => r.contentEnd > r.contentStart);
  if (!rows.length) return { error: 'The table has no rows yet.' };
  const current = [...rows].reverse().find((r) => r.contentStart <= offset) ?? rows[0];
  const column = current.separators.filter((s) => s < offset).length;
  const columns = Math.max(...rows.map((r) => r.separators.length + 1));

  if (op === 'addRow') {
    const lineStart = text.lastIndexOf('\n', current.contentStart - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
    const cells = indent + '& '.repeat(columns - 1);
    if (current.ended) return [{ start: current.after, end: current.after, text: `${eol}${cells}\\\\` }];
    // The last row has no \\ yet: end it, then add the new row.
    return [{ start: current.contentEnd, end: current.contentEnd, text: ` \\\\${eol}${cells.trimEnd()}` }];
  }

  if (op === 'deleteRow') {
    if (rows.length === 1) return { error: 'The table has only one row.' };
    const lineStart = text.lastIndexOf('\n', current.contentStart - 1) + 1;
    const start = /^[ \t]*$/.test(text.slice(lineStart, current.contentStart)) ? lineStart : current.contentStart;
    let end = current.after;
    const rest = /^[ \t]*\r?\n/.exec(text.slice(end));
    if (rest && start === lineStart) end += rest[0].length;
    return [{ start, end, text: '' }];
  }

  if (/\\multicolumn/.test(text.slice(table.bodyStart, table.bodyEnd))) return { error: 'Columns cannot be changed automatically in a table that uses \\multicolumn.' };
  const spec = specColumns(text, table.specStart, table.specEnd);
  if (!spec) return { error: 'The column specification uses *{..}{..}; change it by hand.' };

  if (op === 'addColumn') {
    const edits = rows.map((r) => {
      const at = column < r.separators.length ? r.separators[column] : r.contentEnd;
      return { start: at, end: at, text: column < r.separators.length ? '&  ' : ' & ' };
    });
    const token = spec[Math.min(column, spec.length - 1)];
    if (token) {
      const bar = text[token.end] === '|';
      const at = bar ? token.end + 1 : token.end;
      edits.push({ start: at, end: at, text: bar ? 'l|' : 'l' });
    }
    return edits.sort((a, b) => a.start - b.start);
  }

  // deleteColumn
  if (columns === 1) return { error: 'The table has only one column.' };
  const edits = rows
    .filter((r) => column <= r.separators.length)
    .map((r) => {
      const cellStart = column === 0 ? r.contentStart : r.separators[column - 1] + 1;
      if (column < r.separators.length) return { start: cellStart, end: r.separators[column] + 1, text: '' };
      // Last cell: remove it together with the separator before it.
      return { start: r.separators[column - 1], end: r.contentEnd, text: '' };
    });
  const token = spec[column];
  if (token) edits.push({ start: token.start, end: text[token.end] === '|' && text[token.start - 1] === '|' ? token.end + 1 : token.end, text: '' });
  return edits.sort((a, b) => a.start - b.start);
}

function enclosingTable(text: string, offset: number) {
  let found: { bodyStart: number; bodyEnd: number; specStart: number; specEnd: number } | undefined;
  for (const m of text.matchAll(/\\begin\{(tabular\*?|tabularx|longtable|array)\}/g)) {
    if (m.index! > offset) break;
    const endTag = text.indexOf(`\\end{${m[1]}}`, m.index!);
    if (endTag < offset) continue;
    let pos = m.index! + m[0].length;
    if (m[1] === 'tabularx' || m[1] === 'tabular*') pos = skipGroup(text, pos);
    while (text[pos] === '[') pos = skipGroup(text, pos);
    if (text[pos] !== '{') continue;
    const specEnd = skipGroup(text, pos);
    found = { specStart: pos + 1, specEnd: specEnd - 1, bodyStart: specEnd, bodyEnd: endTag };
  }
  return found;
}

function tableRows(text: string, from: number, to: number): RowSpan[] {
  const rows: RowSpan[] = [];
  let start = from;
  let depth = 0;
  let separators: number[] = [];
  const finish = (end: number, after: number, ended: boolean) => {
    let contentStart = start;
    // Skip whitespace, comments and rule commands at the start of the row.
    for (;;) {
      const m = /^(\s+|%[^\n]*\n?|\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(\([^)]*\))?\{[^}]*\}|endhead|endfirsthead|endfoot|endlastfoot)\b)/.exec(text.slice(contentStart, end));
      if (!m || !m[0]) break;
      contentStart += m[0].length;
    }
    let contentEnd = end;
    while (contentEnd > contentStart && /\s/.test(text[contentEnd - 1])) contentEnd--;
    rows.push({ contentStart, contentEnd, after, ended, separators: separators.filter((s) => s >= contentStart) });
    separators = [];
  };
  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (ch === '%') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 || nl > to ? to : nl;
    } else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '&' && depth === 0) separators.push(i);
    else if (ch === '\\' && text[i + 1] === '\\' && depth === 0) {
      let after = i + 2;
      if (text[after] === '[') after = skipGroup(text, after);
      finish(i, after, true);
      i = after - 1;
      start = after;
    } else if (ch === '\\') i++;
  }
  finish(to, to, false);
  return rows;
}

/** Column tokens of a spec with their offsets, or undefined for specs with *{n}{..}. */
function specColumns(text: string, from: number, to: number): { start: number; end: number }[] | undefined {
  const tokens: { start: number; end: number }[] = [];
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (ch === '*') return undefined;
    if (/\s|\|/.test(ch)) {
      i++;
      continue;
    }
    if ('@!<>'.includes(ch)) {
      i = skipGroup(text, i + 1);
      continue;
    }
    let end = i + 1;
    while (text[end] === '{' || text[end] === '[') end = skipGroup(text, end);
    tokens.push({ start: i, end });
    i = end;
  }
  return tokens;
}
