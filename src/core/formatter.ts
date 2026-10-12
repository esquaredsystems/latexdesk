// Fast built-in formatter for the safe basics: environment indentation, trailing whitespace
// and runs of blank lines. Verbatim-like environments are left untouched. Running it twice
// gives the same result as running it once.

export interface FormatOptions {
  indent: string;
  /** Environments whose content is not indented. */
  noIndent?: string[];
}

const VERBATIM = /^(verbatim\*?|Verbatim|lstlisting|minted|comment|alltt)$/;

export function formatLatex(text: string, options: FormatOptions): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const noIndent = new Set(options.noIndent ?? ['document']);
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let depth = 0;
  let verbatim: string | undefined;
  let blank = 0;

  for (const raw of lines) {
    if (verbatim) {
      out.push(raw);
      if (raw.includes(`\\end{${verbatim}}`)) verbatim = undefined;
      continue;
    }
    const line = raw.trim();
    if (!line) {
      blank++;
      if (blank <= 1) out.push('');
      continue;
    }
    blank = 0;
    const code = line.replace(/(^|[^\\])%.*$/, '$1');
    const begins = [...code.matchAll(/\\begin\{([^}]+)\}/g)].map((m) => m[1]).filter((e) => !noIndent.has(e));
    const ends = [...code.matchAll(/\\end\{([^}]+)\}/g)].map((m) => m[1]).filter((e) => !noIndent.has(e));
    // A line that starts with \end is outdented itself.
    const leadingEnd = /^\\end\{([^}]+)\}/.exec(line);
    const lineDepth = leadingEnd && !noIndent.has(leadingEnd[1]) ? Math.max(0, depth - 1) : depth;
    out.push(options.indent.repeat(lineDepth) + line);
    depth = Math.max(0, depth + begins.length - ends.length);
    const verb = begins.find((b) => VERBATIM.test(b));
    if (verb && !code.includes(`\\end{${verb}}`)) {
      verbatim = verb;
      depth = Math.max(0, depth - 1);
    }
  }
  // Keep the file's final newline (or lack of it).
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') out.pop();
  return out.join(eol);
}
