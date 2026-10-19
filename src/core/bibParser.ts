// A tolerant BibTeX / BibLaTeX parser.
//
// It never rewrites anything: every entry and field records its offsets in the original
// text, so edits can replace exactly one value and leave everything else byte identical.
// Broken entries produce a syntax issue and parsing resumes at the next `@`.
import { LineMap } from './text';

export interface BibField {
  /** Field name in lower case. */
  name: string;
  /** Name as written. */
  rawName: string;
  /** Value without outer braces/quotes, with `#` concatenation kept as written. */
  value: string;
  /** Raw value text including delimiters. */
  raw: string;
  nameStart: number;
  valueStart: number;
  valueEnd: number;
  delimiter: '{' | '"' | '';
}

export interface BibEntry {
  /** Entry type in lower case (article, book, ...). */
  type: string;
  key: string;
  keyStart: number;
  keyEnd: number;
  start: number;
  end: number;
  fields: BibField[];
  line: number;
}

export interface BibSyntaxIssue {
  message: string;
  start: number;
  end: number;
}

export interface BibFile {
  entries: BibEntry[];
  strings: Map<string, { value: string; start: number; end: number }>;
  issues: BibSyntaxIssue[];
  lines: LineMap;
}

export const MONTH_MACROS: Record<string, string> = {
  jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6',
  jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12',
};

export function parseBib(text: string): BibFile {
  const file: BibFile = { entries: [], strings: new Map(), issues: [], lines: new LineMap(text) };
  let pos = 0;

  while (pos < text.length) {
    const at = text.indexOf('@', pos);
    if (at < 0) break;
    const typeMatch = /^@\s*([a-zA-Z]+)\s*([{(])/.exec(text.slice(at, at + 60));
    if (!typeMatch) {
      pos = at + 1;
      continue;
    }
    const type = typeMatch[1].toLowerCase();
    const close = typeMatch[2] === '{' ? '}' : ')';
    const bodyStart = at + typeMatch[0].length;

    if (type === 'comment') {
      pos = skipBalanced(text, bodyStart - 1) ?? bodyStart;
      continue;
    }
    if (type === 'preamble') {
      pos = skipBalanced(text, bodyStart - 1) ?? bodyStart;
      continue;
    }
    if (type === 'string') {
      const end = skipBalanced(text, bodyStart - 1);
      const body = text.slice(bodyStart, end ? end - 1 : text.length);
      const sm = /^\s*([\w:.-]+)\s*=\s*/.exec(body);
      if (sm) {
        const value = readValue(text, bodyStart + sm[0].length, close);
        if (value) file.strings.set(sm[1].toLowerCase(), { value: value.value, start: at, end: end ?? value.end });
      }
      pos = end ?? text.length;
      continue;
    }

    const parsed = parseEntry(text, at, bodyStart, type, close, file.issues);
    if (parsed.entry) {
      parsed.entry.line = file.lines.lineAt(at);
      file.entries.push(parsed.entry);
    }
    pos = Math.max(parsed.next, at + 1);
  }
  return file;
}

function parseEntry(
  text: string,
  start: number,
  bodyStart: number,
  type: string,
  close: string,
  issues: BibSyntaxIssue[],
): { entry?: BibEntry; next: number } {
  const keyMatch = /^\s*([^,\s{}()"=]*)\s*/.exec(text.slice(bodyStart, bodyStart + 300));
  const key = keyMatch ? keyMatch[1] : '';
  const keyStart = bodyStart + (keyMatch ? keyMatch[0].indexOf(key) : 0);
  let pos = bodyStart + (keyMatch ? keyMatch[0].length : 0);
  const entry: BibEntry = { type, key, keyStart, keyEnd: keyStart + key.length, start, end: start, fields: [], line: 0 };

  if (text[pos] !== ',') {
    if (text[pos] === close) {
      entry.end = pos + 1;
      return { entry, next: pos + 1 };
    }
    issues.push({ message: `Missing comma after entry key "${key}"`, start: keyStart, end: Math.max(keyStart + 1, entry.keyEnd) });
  } else {
    pos++;
  }

  while (pos < text.length) {
    // skip whitespace and stray commas
    while (pos < text.length && /[\s,]/.test(text[pos])) pos++;
    if (text[pos] === close) {
      entry.end = pos + 1;
      return { entry, next: pos + 1 };
    }
    if (text[pos] === '@' || pos >= text.length) {
      issues.push({ message: `Entry "${key}" is not closed`, start, end: entry.keyEnd });
      entry.end = pos;
      return { entry, next: pos };
    }
    const nameMatch = /^([a-zA-Z][\w:.+-]*)\s*=\s*/.exec(text.slice(pos, pos + 200));
    if (!nameMatch) {
      const lineEnd = text.indexOf('\n', pos);
      const stop = lineEnd < 0 ? text.length : lineEnd;
      issues.push({ message: `Unexpected text in entry "${key}"`, start: pos, end: Math.max(pos + 1, stop) });
      const nextAt = text.indexOf('@', pos);
      // Try to continue on the next line; give up on this entry if a new one starts first.
      if (nextAt >= 0 && nextAt < stop) {
        entry.end = nextAt;
        return { entry, next: nextAt };
      }
      pos = stop + 1;
      continue;
    }
    const nameStart = pos;
    const valueStart = pos + nameMatch[0].length;
    const value = readValue(text, valueStart, close);
    if (!value) {
      issues.push({ message: `Field "${nameMatch[1]}" has no value or unbalanced braces`, start: nameStart, end: valueStart });
      const nextAt = text.indexOf('\n@', valueStart);
      entry.end = nextAt < 0 ? text.length : nextAt + 1;
      return { entry, next: entry.end };
    }
    entry.fields.push({
      name: nameMatch[1].toLowerCase(),
      rawName: nameMatch[1],
      value: value.value,
      raw: text.slice(valueStart, value.end),
      nameStart,
      valueStart,
      valueEnd: value.end,
      delimiter: value.delimiter,
    });
    pos = value.end;
  }
  issues.push({ message: `Entry "${key}" is not closed`, start, end: entry.keyEnd });
  entry.end = text.length;
  return { entry, next: text.length };
}

/** Reads `{...}`, `"..."`, a number, a macro, or a `#` concatenation of those. */
function readValue(text: string, pos: number, close: string): { value: string; end: number; delimiter: '{' | '"' | '' } | undefined {
  const parts: string[] = [];
  let delimiter: '{' | '"' | '' = '';
  let i = pos;
  for (;;) {
    while (/\s/.test(text[i] ?? '')) i++;
    const ch = text[i];
    if (ch === '{') {
      const end = skipBalanced(text, i);
      if (end === undefined) return undefined;
      parts.push(text.slice(i + 1, end - 1));
      if (!delimiter) delimiter = '{';
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      let depth = 0;
      for (; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        else if (text[j] === '"' && depth === 0 && text[j - 1] !== '\\') break;
      }
      if (j >= text.length) return undefined;
      parts.push(text.slice(i + 1, j));
      if (!delimiter) delimiter = '"';
      i = j + 1;
    } else {
      const bare = /^[^\s,#{}"()]+/.exec(text.slice(i, i + 200));
      if (!bare) return undefined;
      parts.push(bare[0]);
      i += bare[0].length;
    }
    // Remember where the value ends before any trailing whitespace.
    const valueEnd = i;
    while (/\s/.test(text[i] ?? '')) i++;
    if (text[i] === '#') {
      i++;
      continue;
    }
    if (text[i] === ',' || text[i] === close || i >= text.length) {
      return { value: parts.join(''), end: valueEnd, delimiter };
    }
    // Missing comma between fields: accept the value, the next loop reports nothing odd.
    return { value: parts.join(''), end: valueEnd, delimiter };
  }
}

/** Given the index of an opening `{` or `(`, returns the index after its matching close. */
function skipBalanced(text: string, open: number): number | undefined {
  const o = text[open];
  const c = o === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === o) depth++;
    else if (ch === c) {
      depth--;
      if (depth === 0) return i + 1;
    } else if (ch === '@' && o === '{' && depth === 1 && text[i - 1] === '\n') {
      // A new entry starting at the beginning of a line means this one was never closed.
      return undefined;
    }
  }
  return undefined;
}

/** Field value with @string macros and month names expanded, braces removed. */
export function resolvedValue(file: BibFile, field: BibField): string {
  let v = field.value;
  if (field.delimiter === '') {
    const macro = file.strings.get(v.toLowerCase());
    if (macro) v = macro.value;
    else if (MONTH_MACROS[v.toLowerCase()]) v = MONTH_MACROS[v.toLowerCase()];
  }
  // Addresses keep \~ as a literal tilde; everything else gets its accents turned into letters.
  v = LITERAL_FIELDS.has(field.name) ? unescapeTex(v) : decodeTexAccents(v);
  // Drop braces and simple commands such as {\TeX}book -> TeXbook, for display and comparison.
  return v
    .replace(/\\([a-zA-Z]+)\s*/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Combining marks for TeX accent commands: \"o -> ö, \c{s} -> ş, \v{c} -> č.
const SYMBOL_ACCENTS: Record<string, string> = {
  '`': '\u0300', "'": '\u0301', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307', '"': '\u0308',
};
const LETTER_ACCENTS: Record<string, string> = {
  u: '\u0306', r: '\u030A', H: '\u030B', v: '\u030C', d: '\u0323', c: '\u0327', k: '\u0328', b: '\u0331',
};
const SPECIAL_LETTERS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ',
};

/** Replaces TeX accents and special letters with Unicode: {\"O}zi{\c{s}}ik -> {Ö}zi{ş}ik. */
export function decodeTexAccents(text: string): string {
  // The dotless \i and \j are written under accents, as in \'{\i}; the accented letter is a plain i.
  const base = (letter: string) => (letter === '\\i' ? 'i' : letter === '\\j' ? 'j' : letter);
  const decoded = text
    .replace(/\\([`'^~=."])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij](?![A-Za-z])|[A-Za-z]))/g,
      (_m, accent: string, braced?: string, bare?: string) => (base(braced ?? bare ?? '') + SYMBOL_ACCENTS[accent]).normalize('NFC'))
    .replace(/\\([urHvdckb])(?:\s*\{\s*(\\[ij]|[A-Za-z])\s*\}|\s+([A-Za-z]))/g,
      (_m, accent: string, braced?: string, bare?: string) => (base(braced ?? bare ?? '') + LETTER_ACCENTS[accent]).normalize('NFC'))
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|[oOlLij])(?![A-Za-z])\s*/g, (_m, name: string) => SPECIAL_LETTERS[name]);
  return unescapeTex(decoded);
}

const LITERAL_FIELDS = new Set(['url', 'doi', 'file', 'eprint']);

/** \_ -> _, \% -> % and so on, leaving everything else as written. */
function unescapeTex(text: string): string {
  return text.replace(/\\([&%$#_])/g, '$1');
}

/** Lower case without accents, for comparing names and titles: "Özişik" -> "ozisik". */
export function foldForComparison(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function getField(entry: BibEntry, ...names: string[]): BibField | undefined {
  for (const n of names) {
    const f = entry.fields.find((x) => x.name === n);
    if (f) return f;
  }
  return undefined;
}

/** "Knuth, D. E. and Lamport, L." -> ["Knuth", "Lamport"] */
export function authorSurnames(authors: string): string[] {
  return authors
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (a.includes(',') ? a.split(',')[0] : a.split(/\s+/).pop() ?? a).replace(/[{}]/g, '').trim());
}

/** Short one-line description used in completion, hovers and the Bib Manager. */
export function describeEntry(file: BibFile, entry: BibEntry) {
  const get = (...names: string[]) => {
    const f = getField(entry, ...names);
    return f ? resolvedValue(file, f) : '';
  };
  const date = get('year', 'date');
  return {
    key: entry.key,
    type: entry.type,
    author: get('author', 'editor'),
    title: get('title'),
    year: date.slice(0, 4),
    venue: get('journal', 'journaltitle', 'booktitle', 'publisher', 'school', 'institution', 'howpublished', 'archiveprefix'),
  };
}
