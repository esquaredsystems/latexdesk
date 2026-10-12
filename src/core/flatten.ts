// Source transformations used by "Export for submission": inlining \input/\include and removing comments.
import * as path from 'path';
import { maskNonCode } from './text';

/**
 * Replaces \input{..} and \include{..} with the content of the included file, recursively.
 * Commented-out includes are left alone. \include becomes \clearpage + content + \clearpage,
 * which is what LaTeX does (minus the separate .aux file). `report.inlined` lists the files
 * that were inlined; `report.warnings` explains anything left as it was.
 */
export function flattenTex(
  file: string,
  read: (file: string) => string | undefined,
  report: { warnings: string[]; inlined: Set<string> } = { warnings: [], inlined: new Set() },
): string {
  const baseDir = path.dirname(file);
  const visit = (current: string, depth: number, stack: Set<string>): string => {
    const text = read(current) ?? '';
    if (depth > 20 || stack.has(current)) {
      report.warnings.push(`Include cycle or nesting too deep at ${path.basename(current)}; left as is`);
      return text;
    }
    const masked = maskNonCode(text);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let out = '';
    let last = 0;
    for (const m of masked.matchAll(/\\(input|include)\s*\{([^}]+)\}/g)) {
      const target = text.slice(m.index! + m[0].indexOf('{') + 1, m.index! + m[0].length - 1).trim();
      // LaTeX resolves these paths against the folder of the root document.
      let resolved = path.resolve(baseDir, target);
      if (read(resolved) === undefined) resolved += '.tex';
      if (read(resolved) === undefined) {
        report.warnings.push(`Kept \\${m[1]}{${target}}: file not found in the project`);
        continue;
      }
      report.inlined.add(resolved);
      const body = visit(resolved, depth + 1, new Set(stack).add(current)).replace(/\r?\n$/, '');
      out += text.slice(last, m.index!);
      out += m[1] === 'include' ? `\\clearpage${eol}${body}${eol}\\clearpage` : body;
      last = m.index! + m[0].length;
    }
    return out + text.slice(last);
  };
  return visit(file, 0, new Set());
}

const VERBATIM = /\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}/;

/**
 * Removes comments. A line that only holds a comment is dropped; a trailing comment keeps its
 * `%`, because a `%` at the end of a line suppresses the space there and removing it could
 * change the output. Verbatim-like environments are left untouched.
 */
export function stripComments(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  let verbatimEnd: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (verbatimEnd) {
      out.push(line);
      if (line.includes(verbatimEnd)) verbatimEnd = undefined;
      continue;
    }
    const v = VERBATIM.exec(line);
    if (v && !line.includes(`\\end{${v[1]}}`)) verbatimEnd = `\\end{${v[1]}}`;
    const at = commentStart(line);
    if (at < 0 || v) out.push(line);
    else if (line.slice(0, at).trim() === '') continue;
    else out.push(line.slice(0, at + 1));
  }
  return out.join(eol);
}

/** Index of the first `%` that starts a comment (not `\%`), or -1. */
function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '%') return i;
  }
  return -1;
}
