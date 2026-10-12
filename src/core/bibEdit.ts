// Minimal text edits for .bib files. Each function returns the smallest replacement that
// makes the change, so everything else in the file stays byte identical.
import { BibEntry, BibField } from './bibParser';

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Detects the indentation and line ending used inside an entry. */
function entryStyle(text: string, entry: BibEntry) {
  const body = text.slice(entry.start, entry.end);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const indent = /\n([ \t]+)[a-zA-Z]/.exec(body)?.[1] ?? '  ';
  return { eol, indent };
}

/** Replaces a field's value, keeping its delimiter style. Adds the field if it is missing. */
export function setField(text: string, entry: BibEntry, name: string, value: string): TextEdit {
  const field = entry.fields.find((f) => f.name === name.toLowerCase());
  if (field) return replaceValue(field, value);
  return insertFields(text, entry, [[name, value]]);
}

export function replaceValue(field: BibField, value: string): TextEdit {
  const open = field.delimiter === '"' ? '"' : '{';
  const close = field.delimiter === '"' ? '"' : '}';
  // Keep bare numbers bare (year = 2021).
  const text = field.delimiter === '' && /^\d+$/.test(value) ? value : `${open}${value}${close}`;
  return { start: field.valueStart, end: field.valueEnd, text };
}

/** Inserts fields just before the entry's closing brace, adding a comma after the last field if needed. */
export function insertFields(text: string, entry: BibEntry, fields: [string, string][]): TextEdit {
  const { eol, indent } = entryStyle(text, entry);
  const closeAt = entry.end - 1; // position of the closing } or )
  const last = entry.fields[entry.fields.length - 1];
  const afterLast = last ? last.valueEnd : entry.keyEnd;
  const between = text.slice(afterLast, closeAt);
  const hasComma = between.includes(',');
  const lines = fields.map(([n, v]) => `${indent}${n} = {${v}}`);
  if (hasComma) {
    // The entry uses a trailing comma: insert after it and keep that style.
    const commaAt = afterLast + between.indexOf(',') + 1;
    return { start: commaAt, end: commaAt, text: eol + lines.map((l) => l + ',').join(eol) };
  }
  return { start: afterLast, end: afterLast, text: ',' + eol + lines.join(',' + eol) };
}

/** Removes a field including its trailing comma and the line it sits on, when it is alone on that line. */
export function removeField(text: string, field: BibField): TextEdit {
  let start = field.nameStart;
  let end = field.valueEnd;
  const after = /^\s*,/.exec(text.slice(end));
  if (after) end += after[0].length;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
    start = lineStart;
    const nl = /^[ \t]*\r?\n/.exec(text.slice(end));
    if (nl) end += nl[0].length;
  }
  return { start, end, text: '' };
}

export function renameKey(entry: BibEntry, newKey: string): TextEdit {
  return { start: entry.keyStart, end: entry.keyEnd, text: newKey };
}

/** Applies edits to a string (used by tests and the CLI). Edits must not overlap. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let result = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) result = result.slice(0, e.start) + e.text + result.slice(e.end);
  return result;
}

/** Adds `% bib-ignore: <rule>` on its own line just before the entry, in the file's line ending. */
export function suppressEdit(text: string, entry: BibEntry, code: string): TextEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { start: entry.start, end: entry.start, text: `% bib-ignore: ${code.replace(/^bib\//, '')}${eol}` };
}

/** Changes `@article{` to `@book{`, keeping the capitalisation style of the original type. */
export function changeType(text: string, entry: BibEntry, newType: string): TextEdit | undefined {
  const m = /^@(\s*)([a-zA-Z]+)/.exec(text.slice(entry.start, entry.start + 40));
  if (!m) return undefined;
  const old = m[2];
  const styled = old === old.toUpperCase() ? newType.toUpperCase() : old[0] === old[0].toUpperCase() ? newType[0].toUpperCase() + newType.slice(1) : newType;
  const start = entry.start + 1 + m[1].length;
  return { start, end: start + old.length, text: styled };
}
