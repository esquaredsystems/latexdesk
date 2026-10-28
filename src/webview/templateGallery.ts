// Template Gallery webview (OL-53, OL-54): instant search over the whole catalog, type filters,
// paging, and keyboard navigation. The extension host does the downloading and extracting.
import { indexTemplates, IndexedTemplate, queryWords, searchTemplates, SearchResult, Template, TEMPLATE_TYPES, TemplateType, TYPE_LABELS } from '../core/templates';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const PAGE = 50;
type Sort = 'auto' | 'popular' | 'match' | 'name';

const state = {
  index: [] as IndexedTemplate[],
  status: 'Loading the template library…',
  loading: true,
  note: '',
  query: '',
  type: 'all' as TemplateType | 'all',
  sort: 'auto' as Sort,
  shown: PAGE,
  selected: 0,
  busy: '',
  results: [] as SearchResult[],
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Escapes `text` and marks the words of the query, matching the same way as the search. */
function highlight(text: string, words: string[]): string {
  if (!words.length || !text) return esc(text);
  const folded = text.normalize('NFD');
  // Accents are separate code points after NFD; map each folded position back to the original.
  const plain: number[] = [];
  let simple = '';
  for (let i = 0; i < folded.length; i++) {
    if (/[̀-ͯ]/.test(folded[i])) continue;
    simple += folded[i].toLowerCase();
    plain.push(i);
  }
  const marks = new Array<boolean>(folded.length).fill(false);
  for (const w of words) {
    for (let at = simple.indexOf(w); at >= 0; at = simple.indexOf(w, at + 1)) {
      for (let k = at; k < at + w.length; k++) marks[plain[k]] = true;
    }
  }
  // A combining accent belongs to the letter before it.
  for (let i = 1; i < folded.length; i++) if (/[\u0300-\u036f]/.test(folded[i])) marks[i] = marks[i - 1];
  let out = '';
  let open = false;
  for (let i = 0; i < folded.length; i++) {
    if (marks[i] !== open) {
      out += marks[i] ? '<mark>' : '</mark>';
      open = marks[i];
    }
    out += esc(folded[i]);
  }
  return (open ? out + '</mark>' : out).normalize('NFC');
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="top">
    <div>
      <h2>Create from Template</h2>
      <div class="status muted" id="status"></div>
    </div>
    <div class="local">
      <button id="blank" title="Answer a few questions and start from an empty document">Blank project…</button>
      <button id="zip" title="Create a project from a template or project ZIP on your computer">From a ZIP file on disk…</button>
      <button id="refresh" class="ghost" title="Download the template library again">Refresh</button>
    </div>
  </header>
  <div class="searchbar">
    <input id="q" type="search" placeholder="Search by name, publisher, field or keyword" aria-label="Search templates" autocomplete="off" spellcheck="false">
    <label class="sort muted">Sort
      <select id="sort" aria-label="Sort">
        <option value="auto">Best match</option>
        <option value="popular">Most used</option>
        <option value="name">Name</option>
      </select>
    </label>
  </div>
  <div class="chips" id="chips" role="tablist" aria-label="Template type"></div>
  <div class="busy" id="busy" hidden></div>
  <ul class="results" id="results" role="listbox" aria-label="Templates"></ul>
  <div class="more" id="more"></div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('q');
const list = $<HTMLUListElement>('results');

function compute() {
  const matches = searchTemplates(state.index, state.query);
  const counts = new Map<string, number>();
  for (const r of matches) counts.set(r.template.type, (counts.get(r.template.type) ?? 0) + 1);
  let results = state.type === 'all' ? matches : matches.filter((r) => r.template.type === state.type);
  const sort = state.sort === 'auto' ? (state.query.trim() ? 'match' : 'popular') : state.sort;
  if (sort === 'popular') results = [...results].sort((a, b) => a.template.order - b.template.order);
  if (sort === 'name') results = [...results].sort((a, b) => a.template.name.localeCompare(b.template.name));
  state.results = results;
  renderChips(matches.length, counts);
}

function renderChips(total: number, counts: Map<string, number>) {
  const chip = (id: string, label: string, n: number) =>
    `<button class="chip ${state.type === id ? 'active' : ''}" role="tab" aria-selected="${state.type === id}" data-type="${id}" ${n || id === 'all' ? '' : 'disabled'}>${label} <span class="n">${n}</span></button>`;
  $('chips').innerHTML = [chip('all', 'All', total), ...TEMPLATE_TYPES.filter((t) => counts.has(t) || state.type === t).map((t) => chip(t, TYPE_LABELS[t], counts.get(t) ?? 0))].join('');
}

function detail(t: Template): string {
  const rows: [string, string | undefined][] = [
    ['Engine', t.engine],
    ['Bibliography', t.bibliography],
    ['Needs', t.requires.join(', ') || undefined],
    ['Licence', t.license],
  ];
  const actions = t.filename
    ? `<button class="primary" data-act="create">Create project</button>`
    : `<button class="primary" data-act="source">Get from publisher</button><button data-act="zip">Create from a downloaded ZIP…</button>`;
  return `
    <div class="detail">
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <dl>${rows
        .filter(([, v]) => v)
        .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v!)}</dd>`)
        .join('')}
        ${t.source ? `<dt>Source</dt><dd><a href="#" data-act="source">${esc(new URL(t.source).hostname)}</a></dd>` : ''}</dl>
      <div class="actions">${actions}${t.filename && t.source ? `<button class="ghost" data-act="source">Official page ↗</button>` : ''}</div>
      ${t.filename ? '' : '<p class="muted small">This template is not in the library yet: download the kit from the publisher, then create the project from that ZIP.</p>'}
    </div>`;
}

function renderList() {
  const words = queryWords(state.query);
  const visible = state.results.slice(0, state.shown);
  state.selected = Math.min(state.selected, Math.max(0, visible.length - 1));
  if (state.loading) {
    list.innerHTML = '<li class="empty">Loading…</li>';
  } else if (!visible.length) {
    list.innerHTML = state.index.length
      ? `<li class="empty">No template matches “${esc(state.query)}”${state.type !== 'all' ? ` in ${TYPE_LABELS[state.type]}` : ''}. Try fewer or shorter words, or start a blank project.</li>`
      : '<li class="empty">No templates to show. Start a blank project, or create one from a ZIP file on disk.</li>';
  } else {
    list.innerHTML = visible
      .map(({ template: t }, i) => {
        const selected = i === state.selected;
        return `<li role="option" aria-selected="${selected}" class="${selected ? 'selected' : ''}" data-index="${i}" id="opt-${i}">
          <div class="row">
            <span class="name">${highlight(t.name, words)}</span>
            <span class="type">${TYPE_LABELS[t.type]}</span>
          </div>
          <div class="meta muted">${[t.publisher ? highlight(t.publisher, words) : '', t.filename ? '' : 'from the publisher'].filter(Boolean).join(' · ')}</div>
          ${selected ? detail(t) : t.description ? `<div class="desc">${highlight(t.description, words)}</div>` : ''}
          ${t.tags.length ? `<div class="tags">${t.tags.map((g) => `<span>${highlight(g, words)}</span>`).join('')}</div>` : ''}
        </li>`;
      })
      .join('');
    list.setAttribute('aria-activedescendant', `opt-${state.selected}`);
  }
  const rest = state.results.length - visible.length;
  $('more').innerHTML = rest > 0 ? `<button id="showMore">Show ${Math.min(PAGE, rest)} more of ${rest}</button>` : '';
  $('status').textContent = state.loading ? state.status : `${state.status} · ${state.index.length} templates${state.note ? ` · ${state.note}` : ''}`;
  $('busy').hidden = !state.busy;
  $('busy').textContent = state.busy;
}

function update() {
  compute();
  renderList();
}

function selected(): Template | undefined {
  return state.results[state.selected]?.template;
}

function act(action: string, t = selected()) {
  if (!t || state.busy) return;
  if (action === 'create') vscode.postMessage({ type: 'create', id: t.id });
  if (action === 'zip') vscode.postMessage({ type: 'createFromZip', id: t.id });
  if (action === 'source') vscode.postMessage({ type: 'openSource', id: t.id });
}

function select(i: number) {
  state.selected = Math.max(0, Math.min(i, Math.min(state.shown, state.results.length) - 1));
  renderList();
  document.getElementById(`opt-${state.selected}`)?.scrollIntoView({ block: 'nearest' });
}

input.addEventListener('input', () => {
  state.query = input.value;
  state.shown = PAGE;
  state.selected = 0;
  update();
});
$<HTMLSelectElement>('sort').addEventListener('change', (e) => {
  state.sort = (e.target as HTMLSelectElement).value as Sort;
  state.selected = 0;
  update();
});
$('chips').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-type]');
  if (!b) return;
  state.type = b.dataset.type as TemplateType | 'all';
  state.shown = PAGE;
  state.selected = 0;
  update();
});
list.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (action) {
    e.preventDefault();
    act(action);
    return;
  }
  const item = target.closest<HTMLElement>('[data-index]');
  if (item) select(Number(item.dataset.index));
});
list.addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('[data-act]')) return;
  const t = selected();
  if (t) act(t.filename ? 'create' : 'source', t);
});
$('more').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id !== 'showMore') return;
  state.shown += PAGE;
  renderList();
});
$('blank').onclick = () => vscode.postMessage({ type: 'blank' });
$('zip').onclick = () => vscode.postMessage({ type: 'createFromZip' });
$('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });

// Typing anywhere searches; arrows move through the results; Enter creates; Escape clears.
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    select(state.selected + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Enter' && (e.target === input || e.target === document.body || (e.target as HTMLElement).closest('#results'))) {
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'A') return;
    e.preventDefault();
    const t = selected();
    if (t) act(t.filename ? 'create' : 'source', t);
  } else if (e.key === 'Escape' && input.value) {
    input.value = '';
    state.query = '';
    update();
  } else if (e.key.length === 1 && document.activeElement !== input && !(e.target instanceof HTMLInputElement)) {
    input.focus();
  }
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'loading') {
    state.loading = true;
    state.status = 'Loading the template library…';
    renderList();
  } else if (msg.type === 'catalog') {
    state.loading = false;
    state.index = indexTemplates(msg.templates as Template[]);
    state.status = msg.status;
    state.note = [msg.skipped ? `${msg.skipped} invalid entr${msg.skipped === 1 ? 'y' : 'ies'} skipped` : '', msg.newerFormat ? 'update LaTeX Desk to see every detail' : '']
      .filter(Boolean)
      .join(' · ');
    update();
  } else if (msg.type === 'busy') {
    state.busy = msg.text;
    renderList();
  }
});

input.focus();
renderList();
vscode.postMessage({ type: 'ready' });
