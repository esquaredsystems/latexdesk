// Parses TeX engine logs (.log) and BibTeX/Biber logs (.blg) into diagnostics.
// File names come from the "(file" ... ")" stack TeX prints while reading files.

export type LogSeverity = 'error' | 'warning' | 'info' | 'badbox';

export interface LogEntry {
  severity: LogSeverity;
  message: string;
  /** File as written in the log (usually relative to the root directory). */
  file?: string;
  /** 1-based line, when the log says it. */
  line?: number;
  /** A few raw log lines around the message. */
  excerpt: string;
  tool: 'latex' | 'bibtex' | 'biber' | 'makeindex';
}

export interface LogSummary {
  entries: LogEntry[];
  rerunNeeded: boolean;
  undefinedReferences: boolean;
  pages?: number;
  outputFile?: string;
}

const FILE_EXT = /^(?:"([^"]+)"|([^\s()[\]{}"]+\.(?:tex|ltx|sty|cls|cfg|def|clo|aux|toc|bbl|ind|gls|nls|fd|ldf|lof|lot|loa|out|lbx|cbx|bbx|dict|mkii|code\.tex|w18)))/;

/** TeX wraps log lines at 79 characters; glue them back together. */
export function unwrapLog(raw: string, width = 79): string[] {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let current = '';
  for (const line of lines) {
    current += line;
    // A wrapped line is exactly `width` long. Lines that end a message (".") rarely wrap.
    if (line.length === width && !/\.$/.test(line)) continue;
    out.push(current);
    current = '';
  }
  if (current) out.push(current);
  return out;
}

export function parseLatexLog(raw: string): LogSummary {
  const lines = unwrapLog(raw);
  const entries: LogEntry[] = [];
  const stack: string[] = [];
  const summary: LogSummary = { entries, rerunNeeded: false, undefinedReferences: false };
  const currentFile = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
    return undefined;
  };
  const seen = new Set<string>();
  const push = (e: LogEntry) => {
    const id = `${e.severity}|${e.file}|${e.line}|${e.message}`;
    if (seen.has(id)) return;
    seen.add(id);
    entries.push(e);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // -file-line-error style:  ./chapter.tex:12: Undefined control sequence.
    const fle = /^((?:[A-Za-z]:)?[^:\s][^:]*\.(?:tex|sty|cls|ltx|bbl|aux|ind)):(\d+):\s*(.*)$/.exec(line);
    if (fle) {
      const { message, excerpt } = collectError(lines, i, fle[3]);
      push({ severity: 'error', file: fle[1], line: +fle[2], message, excerpt, tool: 'latex' });
      continue;
    }

    if (line.startsWith('! ')) {
      const { message, excerpt, lineNo } = collectError(lines, i, line.slice(2));
      push({ severity: 'error', file: currentFile(), line: lineNo, message, excerpt, tool: 'latex' });
      continue;
    }

    const warn = /^(LaTeX|Package|Class)\s*([\w-]*)\s+Warning:\s*(.*)$/.exec(line);
    if (warn) {
      // Package warnings continue on lines that start with "(pkgname)".
      let message = warn[3];
      let j = i + 1;
      while (j < lines.length && /^\(([\w-]+)\)\s/.test(lines[j])) {
        message += ' ' + lines[j].replace(/^\([\w-]+\)\s+/, '');
        j++;
      }
      // LaTeX's own warnings continue on the next non-empty line until a blank line.
      if (warn[1] === 'LaTeX' && !/\.\s*$/.test(message)) {
        while (j < lines.length && lines[j].trim() && j < i + 4) {
          message += ' ' + lines[j].trim();
          j++;
        }
      }
      const lineMatch = /on input line (\d+)/.exec(message);
      const severity: LogSeverity = /Font Warning/.test(line) ? 'info' : 'warning';
      if (/Rerun to get|Label\(s\) may have changed|Rerun LaTeX/.test(message)) summary.rerunNeeded = true;
      if (/There were undefined (references|citations)|undefined on input line|Citation .* undefined|Reference .* undefined/.test(message)) summary.undefinedReferences = true;
      push({
        severity,
        file: currentFile(),
        line: lineMatch ? +lineMatch[1] : undefined,
        message: message.replace(/\s+/g, ' ').trim(),
        excerpt: lines.slice(i, j).join('\n'),
        tool: 'latex',
      });
      i = j - 1;
      continue;
    }

    const box = /^(Over|Under)full \\[hv]box (\([^)]*\))?.*?(?:at lines? (\d+)(?:--\d+)?|detected at line (\d+)|has occurred while \\output is active)/.exec(line);
    if (box) {
      push({
        severity: 'badbox',
        file: currentFile(),
        line: box[3] ? +box[3] : box[4] ? +box[4] : undefined,
        message: line.replace(/\s+\[\]$/, '').trim(),
        excerpt: line,
        tool: 'latex',
      });
      continue;
    }

    const missingFile = /^No file (.+)\.$/.exec(line);
    if (missingFile) {
      push({ severity: 'info', message: `No file ${missingFile[1]} (it is created by a later pass or tool)`, excerpt: line, tool: 'latex' });
    }
    const output = /^Output written on (.+) \((\d+) pages?/.exec(line);
    if (output) {
      summary.outputFile = output[1];
      summary.pages = +output[2];
    }

    scanParens(line);
  }
  return summary;

  function scanParens(line: string) {
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch === '(') {
        const m = FILE_EXT.exec(line.slice(k + 1));
        if (m) {
          stack.push(m[1] ?? m[2]);
          k += m[0].length;
        } else {
          stack.push('');
        }
      } else if (ch === ')') {
        stack.pop();
      }
    }
  }
}

/** Reads the lines after "! message" up to the "l.123" context line. */
function collectError(lines: string[], start: number, first: string) {
  let message = first.trim();
  let lineNo: number | undefined;
  const excerpt = [lines[start]];
  for (let j = start + 1; j < Math.min(lines.length, start + 12); j++) {
    const l = lines[j];
    excerpt.push(l);
    const m = /^l\.(\d+)\s?(.*)$/.exec(l);
    if (m) {
      lineNo = +m[1];
      // The text after l.N is the source up to the error; the next line is the rest.
      const context = (m[2] + ' ' + (lines[j + 1]?.trim() ?? '')).trim();
      if (context && /Undefined control sequence/.test(message)) {
        const cmd = /(\\[a-zA-Z@]+)\s*$/.exec(m[2]);
        if (cmd) message += ` ${cmd[1]}`;
      }
      if (lines[j + 1]) excerpt.push(lines[j + 1]);
      break;
    }
    if (j === start + 1 && l && !l.startsWith('l.') && !/^\s*$/.test(l) && !l.startsWith('See the') && !l.startsWith('Type ')) {
      // Some errors continue the message on the next line.
      if (/^[a-z(]/.test(l)) message += ' ' + l.trim();
    }
    if (l.startsWith('! ')) break;
  }
  return { message, excerpt: excerpt.join('\n'), lineNo };
}

/** Parses BibTeX or Biber .blg output. */
export function parseBlg(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = raw.split(/\r?\n/);
  const biber = /^\[\d+\] Biber|INFO - This is Biber/m.test(raw);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (biber) {
      const m = /^\[\d+\]\s+[\w:]+>\s*(WARN|ERROR)\s*-\s*(.*)$/.exec(line) ?? /^(WARN|ERROR)\s*-\s*(.*)$/.exec(line);
      if (m) {
        const loc = /line (\d+).*?['"]?([^'"\s]+\.bib)/.exec(m[2]) ?? /([^'"\s]+\.bib)', line (\d+)/.exec(m[2]);
        entries.push({
          severity: m[1] === 'ERROR' ? 'error' : 'warning',
          message: m[2],
          file: loc ? (loc[2]?.endsWith('.bib') ? loc[2] : loc[1]) : undefined,
          line: loc ? +(loc[1].match(/^\d+$/) ? loc[1] : loc[2]) : undefined,
          excerpt: line,
          tool: 'biber',
        });
      }
      continue;
    }
    let m = /^Warning--(.*)$/.exec(line);
    if (m) {
      // "--line 12 of file refs.bib" may follow on the next line.
      const next = /^--line (\d+) of file (.+)$/.exec(lines[i + 1] ?? '');
      entries.push({ severity: 'warning', message: m[1], file: next?.[2], line: next ? +next[1] : undefined, excerpt: line, tool: 'bibtex' });
      continue;
    }
    m = /^(I couldn't open (?:database|style) file .*|I found no .*)$/.exec(line);
    if (m) {
      entries.push({ severity: 'error', message: m[1], excerpt: line, tool: 'bibtex' });
      continue;
    }
    const err = /^(.*)---line (\d+) of file (.+)$/.exec(line);
    if (err) {
      entries.push({ severity: 'error', message: err[1].trim() || 'BibTeX error', file: err[3].trim(), line: +err[2], excerpt: [lines[i - 1], line].filter(Boolean).join('\n'), tool: 'bibtex' });
    }
  }
  return entries;
}

/** Keys reported as missing by BibTeX ("I didn't find a database entry for ..."). */
export function missingCitationKeys(entries: LogEntry[]): string[] {
  const keys: string[] = [];
  for (const e of entries) {
    const m = /didn't find a database entry for "([^"]+)"/.exec(e.message) ?? /Citation [`']([^']+)' .*undefined/.exec(e.message);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}
