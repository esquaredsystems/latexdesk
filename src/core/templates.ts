// Template library (OL-51 to OL-55): catalog parsing, search, and the checks for safe ZIP
// extraction. No vscode or Node imports: the search also runs inside the gallery webview.

export const CATALOG_VERSION = 1;

export const TEMPLATE_TYPES = ['journal', 'conference', 'thesis', 'book', 'report', 'article', 'presentation', 'poster', 'cv', 'letter', 'other'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TYPE_LABELS: Record<TemplateType, string> = {
  journal: 'Journal',
  conference: 'Conference',
  thesis: 'Thesis',
  book: 'Book',
  report: 'Report',
  article: 'Article',
  presentation: 'Slides',
  poster: 'Poster',
  cv: 'CV',
  letter: 'Letter',
  other: 'Other',
};

export interface Template {
  id: string;
  name: string;
  type: TemplateType;
  publisher?: string;
  description?: string;
  tags: string[];
  /** ZIP file relative to the catalog URL, or an absolute https URL. */
  filename?: string;
  main?: string;
  engine?: string;
  bibliography?: string;
  requires: string[];
  license?: string;
  source?: string;
  /** Position in the catalog, which lists the most used templates first. */
  order: number;
}

export interface Catalog {
  version: number;
  updated?: string;
  templates: Template[];
  /** Entries left out because a required field was missing or the id was repeated. */
  skipped: number;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);

/** Reads a parsed templates.json. Accepts `{ templates: [...] }` or a bare array. */
export function parseCatalog(json: unknown): Catalog {
  const root = (Array.isArray(json) ? { templates: json } : json) as Record<string, unknown> | null;
  const list = root && Array.isArray(root.templates) ? root.templates : [];
  const seen = new Set<string>();
  const templates: Template[] = [];
  let skipped = 0;
  for (const raw of list as Record<string, unknown>[]) {
    const id = str(raw?.id);
    const name = str(raw?.name);
    const type = str(raw?.type)?.toLowerCase() as TemplateType | undefined;
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !name || !type || seen.has(id)) {
      skipped++;
      continue;
    }
    seen.add(id);
    templates.push({
      id,
      name,
      type: TEMPLATE_TYPES.includes(type) ? type : 'other',
      publisher: str(raw.publisher),
      description: str(raw.description),
      tags: strings(raw.tags),
      filename: str(raw.filename),
      main: str(raw.main),
      engine: str(raw.engine),
      bibliography: str(raw.bibliography),
      requires: strings(raw.requires),
      license: str(raw.license),
      source: str(raw.source),
      order: templates.length,
    });
  }
  const version = typeof root?.version === 'number' ? root.version : 1;
  return { version, updated: str(root?.updated), templates, skipped };
}

/** Lower case without accents, so "Zürich" matches "zurich". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Splits a query into the words that must all match. */
export function queryWords(query: string): string[] {
  return fold(query)
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean);
}

interface Field {
  text: string;
  words: string[];
  weight: number;
}

export interface IndexedTemplate {
  template: Template;
  fields: Field[];
}

// How much a match in each field counts; a word that starts a word of the field counts double.
const WEIGHTS = { name: 10, publisher: 6, tags: 4, type: 3, description: 1 };

/** Precomputes the folded text of each template once, so every keystroke only compares strings. */
export function indexTemplates(templates: Template[]): IndexedTemplate[] {
  const field = (text: string, weight: number): Field => {
    const folded = fold(text);
    return { text: folded, words: folded.split(/[^\p{L}\p{N}+#]+/u).filter(Boolean), weight };
  };
  return templates.map((t) => ({
    template: t,
    fields: [
      field(t.name, WEIGHTS.name),
      field(t.publisher ?? '', WEIGHTS.publisher),
      field(t.tags.join(' '), WEIGHTS.tags),
      field(`${t.type} ${TYPE_LABELS[t.type]}`, WEIGHTS.type),
      field(t.description ?? '', WEIGHTS.description),
    ],
  }));
}

export interface SearchResult {
  template: Template;
  score: number;
}

/**
 * Every template that matches all words of the query, best first; ties keep the catalog order.
 * An empty query returns the whole catalog in its own order.
 */
export function searchTemplates(index: IndexedTemplate[], query: string): SearchResult[] {
  const words = queryWords(query);
  if (!words.length) return index.map((i) => ({ template: i.template, score: 0 }));
  const results: SearchResult[] = [];
  for (const item of index) {
    let total = 0;
    for (const word of words) {
      let best = 0;
      for (const f of item.fields) {
        if (!f.text.includes(word)) continue;
        const score = f.weight * (f.words.some((w) => w.startsWith(word)) ? 2 : 1);
        if (score > best) best = score;
      }
      if (!best) {
        total = 0;
        break;
      }
      total += best;
    }
    if (total) results.push({ template: item.template, score: total });
  }
  return results.sort((a, b) => b.score - a.score || a.template.order - b.template.order);
}

// ---- safe extraction ----

export const EXTRACT_LIMITS = { files: 2000, bytes: 200 * 1024 * 1024 };

export interface ExtractionPlan {
  /** ZIP entry name and the relative path (forward slashes) it is written to. */
  files: { entry: string; target: string }[];
  error?: string;
}

const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$|^\._/;

/**
 * Decides which ZIP entries to write and where (OL-33, OL-55): rejects absolute paths, drive
 * letters and "..", skips macOS metadata, and drops a single top-level folder.
 */
export function planExtraction(entryNames: string[]): ExtractionPlan {
  const files: { entry: string; parts: string[] }[] = [];
  for (const entry of entryNames) {
    const name = entry.replace(/\\/g, '/');
    if (name.endsWith('/')) continue;
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return { files: [], error: `The ZIP contains an absolute path: ${entry}` };
    const parts = name.split('/').filter((p) => p && p !== '.');
    if (parts.includes('..')) return { files: [], error: `The ZIP contains a path outside its folder: ${entry}` };
    if (!parts.length || parts.includes('__MACOSX') || JUNK.test(parts[parts.length - 1])) continue;
    files.push({ entry, parts });
  }
  if (!files.length) return { files: [], error: 'The ZIP contains no files.' };
  if (files.length > EXTRACT_LIMITS.files) return { files: [], error: `The ZIP has more than ${EXTRACT_LIMITS.files} files.` };

  const top = files[0].parts[0];
  const singleFolder = files.every((f) => f.parts.length > 1 && f.parts[0] === top);
  return { files: files.map((f) => ({ entry: f.entry, target: (singleFolder ? f.parts.slice(1) : f.parts).join('/') })) };
}

/**
 * The root document among the extracted .tex files: the catalog's `main` when it exists, otherwise
 * main.tex if it is a full document, otherwise the shallowest file with \documentclass and \begin{document}.
 */
export function findMainFile(texFiles: { path: string; text: string }[], preferred?: string): string | undefined {
  if (preferred && texFiles.some((f) => f.path === preferred)) return preferred;
  const isDocument = (text: string) => {
    const code = text.replace(/(^|[^\\])%.*$/gm, '$1');
    return /\\documentclass\b/.test(code) && /\\begin\s*\{document\}/.test(code);
  };
  const documents = texFiles.filter((f) => isDocument(f.text)).map((f) => f.path);
  const depth = (p: string) => p.split('/').length;
  const isMain = (p: string) => Number(p.split('/').pop() === 'main.tex');
  return documents.sort((a, b) => isMain(b) - isMain(a) || depth(a) - depth(b) || a.localeCompare(b))[0];
}
