// Small text helpers shared by the parsers. No vscode or Node imports here.

/** Maps character offsets to 0-based line numbers. */
export class LineMap {
  private starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  lineAt(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  position(offset: number): { line: number; character: number } {
    const line = this.lineAt(offset);
    return { line, character: offset - this.starts[line] };
  }

  offsetAt(line: number, character = 0): number {
    return (this.starts[line] ?? this.starts[this.starts.length - 1]) + character;
  }

  get lineCount(): number {
    return this.starts.length;
  }
}

const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'alltt'];

/**
 * Returns a copy of the LaTeX source where comments and verbatim content are replaced
 * by spaces. Offsets and line breaks stay the same, so positions found in the
 * masked text are valid in the original.
 */
export function maskNonCode(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
  };

  // Verbatim environments first, so a % inside them is not treated as a comment.
  for (const env of VERBATIM_ENVS) {
    const begin = `\\begin{${env}}`;
    const end = `\\end{${env}}`;
    let pos = text.indexOf(begin);
    while (pos >= 0) {
      const contentStart = pos + begin.length;
      const endPos = text.indexOf(end, contentStart);
      const contentEnd = endPos < 0 ? text.length : endPos;
      blank(contentStart, contentEnd);
      pos = endPos < 0 ? -1 : text.indexOf(begin, endPos + end.length);
    }
  }

  // \verb|...| (any delimiter)
  const verb = /\\verb\*?([^a-zA-Z\s])/g;
  let m: RegExpExecArray | null;
  while ((m = verb.exec(text))) {
    const close = text.indexOf(m[1], m.index + m[0].length);
    const lineEnd = text.indexOf('\n', m.index);
    if (close > 0 && (lineEnd < 0 || close < lineEnd)) blank(m.index + m[0].length, close);
  }

  // Comments: % up to end of line, unless escaped as \%.
  for (let i = 0; i < text.length; i++) {
    if (out[i] !== '%') continue;
    if (isEscaped(text, i)) continue;
    let j = i;
    while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++;
    blank(i, j);
    i = j;
  }
  return out.join('');
}

/** True when the character at `index` is preceded by an odd number of backslashes. */
export function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

export interface Group {
  content: string;
  /** Offset of the first character inside the brackets. */
  start: number;
  /** Offset just after the closing bracket. */
  end: number;
}

/**
 * Reads a bracketed group starting at `pos` (after optional whitespace).
 * Returns undefined when the next non-space character is not `open`.
 */
export function readGroup(text: string, pos: number, open = '{', close = '}'): Group | undefined {
  let i = pos;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  if (text[i] !== open) return undefined;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { content: text.slice(i + 1, j), start: i + 1, end: j + 1 };
    }
    // An optional argument never spans a paragraph; stop runaway reads.
    if (open === '[' && ch === '\n' && text[j + 1] === '\n') return undefined;
  }
  return undefined;
}

/** Reads `[opt]{req}{req}...` after a command. Stops at the first missing required group. */
export function readArgs(text: string, pos: number, required: number, optional = true) {
  const opts: Group[] = [];
  const args: Group[] = [];
  let i = pos;
  if (optional) {
    let g = readGroup(text, i, '[', ']');
    while (g) {
      opts.push(g);
      i = g.end;
      g = readGroup(text, i, '[', ']');
    }
  }
  for (let n = 0; n < required; n++) {
    const g = readGroup(text, i);
    if (!g) break;
    args.push(g);
    i = g.end;
    // Optional arguments can also follow a required one (e.g. \subimport*{dir}[opt]{file}).
  }
  return { opts, args, end: i };
}

/** Splits a comma separated argument such as `a, b,c` and returns each item with its offset. */
export function splitList(group: Group): { value: string; offset: number }[] {
  const items: { value: string; offset: number }[] = [];
  let start = 0;
  const parts = group.content.split(',');
  for (const part of parts) {
    const lead = part.length - part.trimStart().length;
    const value = part.trim();
    if (value) items.push({ value, offset: group.start + start + lead });
    start += part.length + 1;
  }
  return items;
}
