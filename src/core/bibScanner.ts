// Rule engine that checks a parsed bibliography for missing fields, bad values and duplicates.
// Every finding has a stable code (bib/...), a severity and an exact text range.
import fields from '../../data/bibFields.json';
import { BibEntry, BibField, BibFile, getField, resolvedValue, MONTH_MACROS, authorSurnames, foldForComparison } from './bibParser';

export type Severity = 'error' | 'warning' | 'info' | 'hint';
export type Dialect = 'bibtex' | 'biblatex';
export type Profile = 'minimal' | 'standard' | 'strict';

export interface BibFinding {
  code: string;
  severity: Severity;
  message: string;
  start: number;
  end: number;
  entryKey?: string;
  /** Data a quick fix needs, e.g. the missing field names or the corrected value. */
  fix?: { kind: 'insertFields'; fields: string[] } | { kind: 'replace'; start: number; end: number; text: string };
}

export interface ScanOptions {
  dialect: Dialect;
  profile: Profile;
  /** Keys cited in the project. When given, uncited entries are reported. */
  citedKeys?: Set<string>;
  uncitedSeverity?: Severity | 'off';
  /** Per-rule severity overrides: { "bib/missing-doi": "off" } */
  overrides?: Record<string, Severity | 'off'>;
  /** Current year, injectable for tests. */
  currentYear?: number;
}

export interface EntryReport {
  key: string;
  score: number;
  findings: BibFinding[];
}

export interface ScanResult {
  findings: BibFinding[];
  entries: Map<BibEntry, EntryReport>;
  /** Groups of entries that look like the same work. */
  duplicateGroups: { reason: string; possible: boolean; keys: string[] }[];
}

const DEFAULT_SEVERITY: Record<string, Severity> = {
  'bib/syntax': 'error',
  'bib/duplicate-key': 'error',
  'bib/invalid-key': 'error',
  'bib/missing-required': 'warning',
  'bib/missing-recommended': 'info',
  'bib/missing-doi': 'info',
  'bib/unknown-type': 'warning',
  'bib/unknown-field': 'hint',
  'bib/duplicate-field': 'warning',
  'bib/empty-field': 'warning',
  'bib/placeholder-value': 'warning',
  'bib/et-al': 'warning',
  'bib/author-format': 'warning',
  'bib/invalid-year': 'warning',
  'bib/invalid-month': 'warning',
  'bib/page-range': 'info',
  'bib/invalid-doi': 'warning',
  'bib/doi-url': 'hint',
  'bib/invalid-url': 'warning',
  'bib/invalid-isbn': 'warning',
  'bib/unescaped-char': 'warning',
  'bib/unbalanced-braces': 'error',
  'bib/undefined-string': 'error',
  'bib/missing-crossref': 'warning',
  'bib/duplicate-work': 'warning',
  'bib/uncited': 'hint',
};

export const RULE_CODES = Object.keys(DEFAULT_SEVERITY);

const PLACEHOLDER = /^(todo|tbd|tba|\?+|x{2,}|unknown|lorem\b.*|n\/?a|fixme|-+)$/i;
const NON_PROSE_FIELDS = new Set(['url', 'doi', 'file', 'eprint', 'isbn', 'issn', 'urldate', 'crossref', 'xdata', 'ids', 'keywords', 'mendeley-tags', 'groups']);
const KNOWN_FIELDS = new Set<string>(fields.knownFields);

export function requiredFields(type: string, dialect: Dialect): string[] | undefined {
  const table = fields[dialect] as Record<string, string[]>;
  return table[type];
}

export function recommendedFields(type: string, profile: Profile): string[] {
  const table = fields.recommended[profile] as Record<string, string[]>;
  return table[type] ?? [];
}

/** Optional fields shown in the entry form; types without a table get the common ones. */
export function optionalFields(type: string): string[] {
  const table = fields.optional as Record<string, string[] | string>;
  const list = table[type];
  return Array.isArray(list) ? list : ['note', 'doi', 'url'];
}

export function scanBib(file: BibFile, text: string, options: ScanOptions): ScanResult {
  const findings: BibFinding[] = [];
  const entries = new Map<BibEntry, EntryReport>();
  const currentYear = options.currentYear ?? new Date().getFullYear();

  const add = (entry: BibEntry | undefined, f: Omit<BibFinding, 'severity'>) => {
    const override = options.overrides?.[f.code];
    if (override === 'off') return;
    if (entry && isSuppressed(text, file, entry, f.code)) return;
    const finding: BibFinding = { ...f, severity: override ?? DEFAULT_SEVERITY[f.code] ?? 'warning', entryKey: entry?.key };
    findings.push(finding);
    if (entry) entries.get(entry)?.findings.push(finding);
  };

  for (const issue of file.issues) add(undefined, { code: 'bib/syntax', message: issue.message, start: issue.start, end: issue.end });

  const byKey = new Map<string, BibEntry[]>();
  for (const e of file.entries) {
    entries.set(e, { key: e.key, score: 100, findings: [] });
    const k = e.key.toLowerCase();
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }

  for (const entry of file.entries) {
    const keyRange = { start: entry.keyStart, end: Math.max(entry.keyEnd, entry.keyStart + 1) };
    if (!entry.key || /[\s,{}"#%'()=\\]/.test(entry.key)) {
      add(entry, { code: 'bib/invalid-key', message: `Entry key "${entry.key}" is empty or contains characters BibTeX does not allow`, ...keyRange });
    }
    if ((byKey.get(entry.key.toLowerCase())?.length ?? 0) > 1) {
      add(entry, { code: 'bib/duplicate-key', message: `Key "${entry.key}" is defined more than once (keys are case-insensitive)`, ...keyRange });
    }

    // Fields inherited through crossref/xdata count as present.
    const available = collectFields(file, entry);
    const required = requiredFields(entry.type, options.dialect);
    if (!required) {
      add(entry, { code: 'bib/unknown-type', message: `Unknown entry type @${entry.type} for ${options.dialect}`, start: entry.start, end: entry.keyStart });
    }
    const missing = (required ?? []).filter((alt) => !alt.split('|').some((f) => hasValue(available.get(f))));
    if (missing.length) {
      add(entry, {
        code: 'bib/missing-required',
        message: `@${entry.type} "${entry.key}" is missing required field${missing.length > 1 ? 's' : ''}: ${missing.map((m) => m.replace('|', ' or ')).join(', ')}`,
        ...keyRange,
        fix: { kind: 'insertFields', fields: missing.map((m) => m.split('|')[0]) },
      });
    }
    const recommended = recommendedFields(entry.type, options.profile).filter((alt) => !alt.split('|').some((f) => hasValue(available.get(f))));
    for (const rec of recommended) {
      const name = rec.split('|')[0];
      add(entry, {
        code: name === 'doi' ? 'bib/missing-doi' : 'bib/missing-recommended',
        message: `${rec.replace('|', ' or ')} is recommended for @${entry.type} (${options.profile} profile)`,
        ...keyRange,
        fix: { kind: 'insertFields', fields: [name] },
      });
    }

    const seen = new Set<string>();
    for (const field of entry.fields) {
      if (seen.has(field.name)) {
        add(entry, { code: 'bib/duplicate-field', message: `Field "${field.name}" appears twice in "${entry.key}"`, start: field.nameStart, end: field.nameStart + field.rawName.length });
      }
      seen.add(field.name);
      checkField(entry, field);
    }

    const crossref = getField(entry, 'crossref');
    if (crossref && !byKey.has(resolvedValue(file, crossref).toLowerCase())) {
      add(entry, { code: 'bib/missing-crossref', message: `crossref target "${crossref.value}" is not defined in this file`, start: crossref.valueStart, end: crossref.valueEnd });
    }

    if (options.citedKeys && options.uncitedSeverity !== 'off' && !options.citedKeys.has(entry.key) && entry.type !== 'xdata' && entry.type !== 'set') {
      const override = options.overrides?.['bib/uncited'] ?? options.uncitedSeverity;
      if (override !== 'off' && !isSuppressed(text, file, entry, 'bib/uncited')) {
        const finding: BibFinding = { code: 'bib/uncited', severity: override ?? 'hint', message: `"${entry.key}" is never cited`, ...keyRange, entryKey: entry.key };
        findings.push(finding);
        entries.get(entry)?.findings.push(finding);
      }
    }
  }

  const duplicateGroups = findDuplicateWorks(file);
  for (const group of duplicateGroups) {
    for (const key of group.keys) {
      const entry = file.entries.find((e) => e.key === key);
      if (!entry) continue;
      const others = group.keys.filter((k) => k !== key).join(', ');
      add(entry, {
        code: 'bib/duplicate-work',
        message: `${group.possible ? 'Possibly the same work' : 'Same work'} as ${others} (${group.reason})`,
        start: entry.keyStart,
        end: Math.max(entry.keyEnd, entry.keyStart + 1),
      });
    }
  }

  for (const [entry, report] of entries) report.score = completenessScore(file, entry, options, report.findings);
  return { findings, entries, duplicateGroups };

  function checkField(entry: BibEntry, field: BibField) {
    const valueRange = { start: field.valueStart, end: Math.max(field.valueEnd, field.valueStart + 1) };
    const value = resolvedValue(file, field);

    if (field.delimiter === '' && !/^\d+$/.test(field.value)) {
      const macro = field.value.toLowerCase();
      if (!file.strings.has(macro) && !MONTH_MACROS[macro]) {
        add(entry, { code: 'bib/undefined-string', message: `@string "${field.value}" is not defined`, ...valueRange });
      }
    }
    if (!KNOWN_FIELDS.has(field.name)) {
      const suggestion = closestField(field.name);
      if (suggestion) {
        add(entry, {
          code: 'bib/unknown-field',
          message: `Unknown field "${field.name}". Did you mean "${suggestion}"?`,
          start: field.nameStart,
          end: field.nameStart + field.rawName.length,
          fix: { kind: 'replace', start: field.nameStart, end: field.nameStart + field.rawName.length, text: suggestion },
        });
      }
    }
    if (!value) {
      add(entry, { code: 'bib/empty-field', message: `Field "${field.name}" is empty`, ...valueRange });
      return;
    }
    if (PLACEHOLDER.test(value)) {
      add(entry, { code: 'bib/placeholder-value', message: `"${value}" looks like a placeholder`, ...valueRange });
    }
    if (braceBalance(field.value) !== 0) {
      add(entry, { code: 'bib/unbalanced-braces', message: `Unbalanced braces in "${field.name}"`, ...valueRange });
    }

    switch (field.name) {
      case 'author':
      case 'editor': {
        const etAl = /,?\s*(et\.?\s*al\.?)\s*$/i.exec(field.value);
        if (etAl) {
          const s = field.valueStart + (field.delimiter ? 1 : 0) + etAl.index;
          add(entry, {
            code: 'bib/et-al',
            message: 'Write "and others" instead of "et al." so BibTeX styles can format it',
            start: s,
            end: s + etAl[0].length,
            fix: { kind: 'replace', start: s, end: s + etAl[0].length, text: ' and others' },
          });
        } else if (/\band\s*$|^\s*and\b|\band\s+and\b/i.test(value)) {
          add(entry, { code: 'bib/author-format', message: 'Name list has an empty name (stray "and")', ...valueRange });
        }
        break;
      }
      case 'year': {
        const year = parseInt(value, 10);
        if (!/^\d{4}$/.test(value) || year < 1400 || year > currentYear + 1) {
          add(entry, { code: 'bib/invalid-year', message: `Year "${value}" is not a plausible four-digit year`, ...valueRange });
        }
        break;
      }
      case 'month': {
        const ok = /^(1[0-2]|[1-9])$/.test(value) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i.test(value);
        if (!ok) add(entry, { code: 'bib/invalid-month', message: `"${value}" is not a month`, ...valueRange });
        break;
      }
      case 'pages': {
        const single = /^(\w+)\s*(?:-|–|—)\s*(\w+)$/.exec(field.value);
        if (single && !field.value.includes('--')) {
          const inner = field.valueStart + (field.delimiter ? 1 : 0);
          add(entry, {
            code: 'bib/page-range',
            message: 'Page ranges use "--" in BibTeX',
            ...valueRange,
            fix: { kind: 'replace', start: inner, end: inner + field.value.length, text: `${single[1]}--${single[2]}` },
          });
        }
        break;
      }
      case 'doi': {
        const bare = value.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
        if (!/^10\.\d{4,9}\/\S+$/.test(bare)) {
          add(entry, { code: 'bib/invalid-doi', message: `"${value}" is not a valid DOI (expected 10.xxxx/...)`, ...valueRange });
        } else if (bare !== value) {
          const inner = field.valueStart + (field.delimiter ? 1 : 0);
          add(entry, {
            code: 'bib/doi-url',
            message: 'Store the DOI without the https://doi.org/ prefix',
            ...valueRange,
            fix: { kind: 'replace', start: inner, end: inner + field.value.length, text: bare },
          });
        }
        break;
      }
      case 'url': {
        if (!/^(https?|ftp):\/\/[^\s]+$/i.test(value.replace(/\\_/g, '_').replace(/\\%/g, '%'))) {
          add(entry, { code: 'bib/invalid-url', message: `"${value}" is not a valid URL`, ...valueRange });
        }
        break;
      }
      case 'isbn': {
        if (!isValidIsbn(value)) add(entry, { code: 'bib/invalid-isbn', message: `ISBN "${value}" has a wrong length or checksum`, ...valueRange });
        break;
      }
    }

    if (!NON_PROSE_FIELDS.has(field.name)) {
      const re = /(^|[^\\])([&#_$%])/g;
      // $...$ math is fine in titles; only flag &, #, _ and lone % characters.
      let m: RegExpExecArray | null;
      while ((m = re.exec(field.value))) {
        const ch = m[2];
        if (ch === '$') continue;
        if (ch === '_' && /\$[^$]*_/.test(field.value)) continue;
        const pos = field.valueStart + (field.delimiter ? 1 : 0) + m.index + m[1].length;
        add(entry, {
          code: 'bib/unescaped-char',
          message: `Unescaped "${ch}" in ${field.name}; write \\${ch}`,
          start: pos,
          end: pos + 1,
          fix: { kind: 'replace', start: pos, end: pos + 1, text: '\\' + ch },
        });
      }
    }
  }
}

function hasValue(field: BibField | undefined): boolean {
  return !!field && field.value.replace(/[{}\s]/g, '') !== '';
}

/** Fields of the entry plus anything inherited via crossref or xdata. */
function collectFields(file: BibFile, entry: BibEntry, depth = 0): Map<string, BibField> {
  const result = new Map<string, BibField>();
  if (depth < 4) {
    for (const linkName of ['crossref', 'xdata']) {
      const link = getField(entry, linkName);
      if (!link) continue;
      for (const target of resolvedValue(file, link).split(',')) {
        const parent = file.entries.find((e) => e.key.toLowerCase() === target.trim().toLowerCase());
        if (!parent) continue;
        for (const [name, f] of collectFields(file, parent, depth + 1)) {
          // BibTeX maps the parent's title to booktitle for crossref children.
          result.set(name === 'title' && linkName === 'crossref' ? 'booktitle' : name, f);
          if (name === 'title') result.set('maintitle', f);
        }
      }
    }
  }
  for (const f of entry.fields) result.set(f.name, f);
  return result;
}

function completenessScore(file: BibFile, entry: BibEntry, options: ScanOptions, findings: BibFinding[]): number {
  const available = collectFields(file, entry);
  const required = requiredFields(entry.type, options.dialect) ?? [];
  const recommended = recommendedFields(entry.type, options.profile === 'minimal' ? 'standard' : options.profile);
  const share = (list: string[]) =>
    list.length === 0 ? 1 : list.filter((alt) => alt.split('|').some((f) => hasValue(available.get(f)))).length / list.length;
  const quality = findings.filter((f) => !['bib/missing-required', 'bib/missing-recommended', 'bib/missing-doi', 'bib/uncited'].includes(f.code)).length;
  const score = 70 * share(required) + 20 * share(recommended) + 10 * Math.max(0, 1 - quality * 0.25);
  return Math.round(score);
}

function normalizeTitle(s: string): string {
  return foldForComparison(s).replace(/\\[a-z]+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findDuplicateWorks(file: BibFile) {
  const groups: { reason: string; possible: boolean; keys: string[] }[] = [];
  const grouped = new Set<string>();
  const byId = (fieldName: string, normalize: (v: string) => string, reason: string) => {
    const map = new Map<string, string[]>();
    for (const e of file.entries) {
      const f = getField(e, fieldName);
      if (!f) continue;
      const v = normalize(resolvedValue(file, f));
      if (!v) continue;
      map.set(v, [...(map.get(v) ?? []), e.key]);
    }
    for (const keys of map.values()) {
      if (keys.length > 1 && !keys.every((k) => grouped.has(k))) {
        groups.push({ reason, possible: false, keys });
        keys.forEach((k) => grouped.add(k));
      }
    }
  };
  byId('doi', (v) => v.toLowerCase().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, ''), 'same DOI');
  byId('eprint', (v) => v.toLowerCase().replace(/v\d+$/, ''), 'same arXiv id');
  byId('isbn', (v) => v.replace(/[^0-9xX]/g, ''), 'same ISBN');

  const fuzzy = new Map<string, string[]>();
  for (const e of file.entries) {
    if (grouped.has(e.key)) continue;
    const title = getField(e, 'title');
    const author = getField(e, 'author', 'editor');
    const year = getField(e, 'year', 'date');
    if (!title || !author || !year) continue;
    const surname = foldForComparison(authorSurnames(resolvedValue(file, author))[0] ?? '');
    const sig = `${normalizeTitle(resolvedValue(file, title))}|${surname}|${resolvedValue(file, year).slice(0, 4)}`;
    fuzzy.set(sig, [...(fuzzy.get(sig) ?? []), e.key]);
  }
  for (const keys of fuzzy.values()) {
    if (keys.length > 1) groups.push({ reason: 'same title, first author and year', possible: true, keys });
  }
  return groups;
}

function isSuppressed(text: string, file: BibFile, entry: BibEntry, code: string): boolean {
  // `% bib-ignore: missing-required doi` on the lines just before the entry.
  const before = text.slice(Math.max(0, entry.start - 300), entry.start);
  const lastEntryEnd = file.entries.filter((e) => e.end <= entry.start).pop()?.end ?? 0;
  const gap = before.slice(Math.max(0, before.length - (entry.start - lastEntryEnd)));
  const rules = [...gap.matchAll(/bib-ignore:\s*([^\r\n]*)/g)].flatMap((m) => m[1].split(/[\s,]+/)).filter(Boolean);
  return rules.includes('all') || rules.includes(code.replace(/^bib\//, '')) || rules.includes(code);
}

function braceBalance(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    if (depth < 0) return depth;
  }
  return depth;
}

export function isValidIsbn(raw: string): boolean {
  const s = raw.replace(/[-\s]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : +s[i]) * (10 - i);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += +s[i] * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

function closestField(name: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const known of KNOWN_FIELDS) {
    const d = editDistance(name, known);
    if (d < bestDistance) {
      bestDistance = d;
      best = known;
    }
  }
  // Short names are too easy to "correct" wrongly.
  return name.length >= 4 ? best : undefined;
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Detects the dialect from the packages a project loads. */
export function detectDialect(packages: string[], setting: 'auto' | Dialect = 'auto'): Dialect {
  if (setting !== 'auto') return setting;
  return packages.includes('biblatex') ? 'biblatex' : 'bibtex';
}
