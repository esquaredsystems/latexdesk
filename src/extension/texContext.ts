// Helpers that look at the text around the cursor.
import * as vscode from 'vscode';

export interface ArgumentAt {
  command: string;
  /** The whole argument text and its range. */
  arg: string;
  argRange: vscode.Range;
  /** The comma separated item under the cursor (e.g. one citation key) and its range. */
  item: string;
  itemRange: vscode.Range;
}

/** Finds `\command[...]{arg}` on the line whose braces contain `pos`. */
export function argumentAt(doc: vscode.TextDocument, pos: vscode.Position): ArgumentAt | undefined {
  const line = doc.lineAt(pos.line).text;
  const re = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const argStart = m.index + m[0].length - 1 - m[2].length;
    const argEnd = argStart + m[2].length;
    if (pos.character < argStart || pos.character > argEnd) continue;
    // Find the comma separated item under the cursor.
    let start = argStart;
    for (const part of m[2].split(',')) {
      const end = start + part.length;
      if (pos.character >= start && pos.character <= end) {
        const lead = part.length - part.trimStart().length;
        const item = part.trim();
        return {
          command: m[1],
          arg: m[2],
          argRange: new vscode.Range(pos.line, argStart, pos.line, argEnd),
          item,
          itemRange: new vscode.Range(pos.line, start + lead, pos.line, start + lead + item.length),
        };
      }
      start = end + 1;
    }
  }
  return undefined;
}

/** For completion: an argument that is still being typed, e.g. `\cite{knu|`. */
export function openArgument(doc: vscode.TextDocument, pos: vscode.Position): { command: string; partial: string; range: vscode.Range; closedAfter: boolean } | undefined {
  const before = doc.lineAt(pos.line).text.slice(0, pos.character);
  const m = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^{}]*)$/.exec(before);
  if (!m) return undefined;
  const partial = m[2].split(',').pop() ?? '';
  const trimmed = partial.trimStart();
  const start = pos.character - trimmed.length;
  const after = doc.lineAt(pos.line).text.slice(pos.character);
  return { command: m[1], partial: trimmed, range: new vscode.Range(pos.line, start, pos.line, pos.character), closedAfter: after.startsWith('}') };
}

/** Rough check whether `pos` is inside math (inline $...$, \(...\), \[...\] or a math environment). */
export function mathAt(doc: vscode.TextDocument, pos: vscode.Position): { tex: string; range: vscode.Range; display: boolean } | undefined {
  const offset = doc.offsetAt(pos);
  const text = doc.getText();
  const windowStart = Math.max(0, offset - 3000);
  const windowText = text.slice(windowStart, offset + 3000);
  const local = offset - windowStart;
  const patterns: [RegExp, boolean][] = [
    [/\\begin\{(equation|align|gather|multline|eqnarray|displaymath)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g, true],
    [/\\\[([\s\S]*?)\\\]/g, true],
    [/\$\$([\s\S]*?)\$\$/g, true],
    [/\\\(([\s\S]*?)\\\)/g, false],
    [/(?<![\\$])\$([^$\n]+?)\$/g, false],
  ];
  for (const [re, display] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(windowText))) {
      if (local >= m.index && local <= m.index + m[0].length) {
        let tex = display && m[3] !== undefined ? m[3] : m[1];
        const env = m[3] !== undefined ? m[1] : undefined;
        if (env === 'align' || env === 'eqnarray') tex = `\\begin{aligned}${tex}\\end{aligned}`;
        else if (env === 'gather') tex = `\\begin{gathered}${tex}\\end{gathered}`;
        tex = tex.replace(/\\(label|nonumber|notag)\{?[^}\s]*\}?/g, '');
        return {
          tex,
          display,
          range: new vscode.Range(doc.positionAt(windowStart + m.index), doc.positionAt(windowStart + m.index + m[0].length)),
        };
      }
    }
  }
  return undefined;
}
