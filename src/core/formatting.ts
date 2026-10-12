// Text operations behind the editor toolbars: wrap/unwrap a command, change text size, align
// lines with an environment. Each returns a single replacement so the editor can apply it as one
// undoable edit and keep the selection on the text.

export interface Replacement {
  start: number;
  end: number;
  text: string;
  /** Selection to set afterwards, as offsets into the new text. */
  selectStart: number;
  selectEnd: number;
}

/**
 * Wraps text[start, end) in `\cmd{...}`, or removes the command when the selection is already
 * wrapped in it (selected with or without the command itself).
 */
export function toggleCommand(text: string, start: number, end: number, cmd: string): Replacement {
  const open = `\\${cmd}{`;
  const selected = text.slice(start, end);
  // The selection is the whole command: \textbf{word}
  if (selected.startsWith(open) && selected.endsWith('}') && closingBrace(selected, open.length - 1) === selected.length - 1) {
    const inner = selected.slice(open.length, -1);
    return { start, end, text: inner, selectStart: start, selectEnd: start + inner.length };
  }
  // The selection is the argument: \textbf{|word|}
  if (text.slice(start - open.length, start) === open && text[end] === '}' && closingBrace(text, start - 1) === end) {
    return { start: start - open.length, end: end + 1, text: selected, selectStart: start - open.length, selectEnd: start - open.length + selected.length };
  }
  return { start, end, text: open + selected + '}', selectStart: start + open.length, selectEnd: start + open.length + selected.length };
}

export const SIZES = ['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge'];

/**
 * Makes the selected text one step larger or smaller: `word` -> `{\large word}` -> `{\Large word}`.
 * Reaching \normalsize removes the group again.
 */
export function changeSize(text: string, start: number, end: number, step: 1 | -1): Replacement {
  const selected = text.slice(start, end);
  // Is the selection already a size group, or the inside of one?
  const whole = /^\{\\([a-zA-Z]+) ([\s\S]*)\}$/.exec(selected);
  let current = 'normalsize';
  let inner = selected;
  let from = start;
  let to = end;
  if (whole && SIZES.includes(whole[1])) {
    current = whole[1];
    inner = whole[2];
  } else {
    const before = /\{\\([a-zA-Z]+) $/.exec(text.slice(Math.max(0, start - 20), start));
    if (before && SIZES.includes(before[1]) && text[end] === '}') {
      current = before[1];
      from = start - before[0].length;
      to = end + 1;
    }
  }
  const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(current) + step))];
  const replacement = next === 'normalsize' ? inner : `{\\${next} ${inner}}`;
  const innerAt = next === 'normalsize' ? from : from + next.length + 3;
  return { start: from, end: to, text: replacement, selectStart: innerAt, selectEnd: innerAt + inner.length };
}

export const ALIGN_ENVIRONMENTS = ['flushleft', 'center', 'flushright', 'justify'];

/**
 * Puts whole lines [lineStart, lineEnd) into an alignment environment. If they already sit
 * directly inside one, that environment is changed, or removed when it is the same.
 */
export function alignLines(text: string, lineStart: number, lineEnd: number, env: string, eol = '\n'): Replacement {
  const block = text.slice(lineStart, lineEnd).replace(/(\r?\n)$/, '');
  const beginRe = new RegExp(`\\\\begin\\{(${ALIGN_ENVIRONMENTS.join('|')})\\}[ \\t]*\\r?\\n$`);
  const before = beginRe.exec(text.slice(Math.max(0, lineStart - 40), lineStart));
  if (before) {
    const endTag = `\\end{${before[1]}}`;
    const afterBlock = lineStart + block.length;
    const after = new RegExp(`^\\r?\\n[ \\t]*${endTag.replace(/[\\{}]/g, '\\$&')}`).exec(text.slice(afterBlock));
    if (after) {
      const from = lineStart - before[0].length;
      const to = afterBlock + after[0].length;
      const replacement = before[1] === env ? block : `\\begin{${env}}${eol}${block}${eol}\\end{${env}}`;
      const innerAt = before[1] === env ? from : from + `\\begin{${env}}`.length + eol.length;
      return { start: from, end: to, text: replacement, selectStart: innerAt, selectEnd: innerAt + block.length };
    }
  }
  const replacement = `\\begin{${env}}${eol}${block}${eol}\\end{${env}}`;
  const innerAt = lineStart + `\\begin{${env}}`.length + eol.length;
  return { start: lineStart, end: lineStart + block.length, text: replacement, selectStart: innerAt, selectEnd: innerAt + block.length };
}

/** Index of the `}` that closes the `{` at `open`, or -1. */
function closingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
