// Looks up a friendly explanation for a log message in data/errors.json.
import data from '../../data/errors.json';

export interface Explanation {
  id: string;
  title: string;
  meaning: string;
  causes: string[];
  fix: string;
}

export interface Rule extends Explanation {
  pattern: string;
}

const compiled = (data.entries as Rule[]).map((r) => ({ rule: r, re: new RegExp(r.pattern) }));

export function explain(message: string, extra: Rule[] = []): Explanation | undefined {
  for (const r of extra) {
    try {
      if (new RegExp(r.pattern).test(message)) return r;
    } catch {
      // An invalid user pattern is ignored rather than breaking diagnostics.
    }
  }
  return compiled.find((c) => c.re.test(message))?.rule;
}
