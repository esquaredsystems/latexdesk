// Bib Manager webview: filterable, sortable, virtualized table + detail drawer, a triage queue
// (one rule at a time) and a health report.
export {};
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): any; setState(s: unknown): void };
const vscode = acquireVsCodeApi();

interface Finding {
  code: string; severity: string; message: string; fixable: boolean; safe: boolean; start: number;
  missing?: string[]; replacement?: string;
}
interface Row {
  key: string; type: string; author: string; title: string; year: string; venue: string;
  cited: number | null; citedIn: { file: string; path: string; line: number }[];
  score: number; issues: number; incomplete: boolean; missingDoi: boolean; duplicate: boolean; possibleDuplicate: boolean;
  findings: Finding[]; fields: { name: string; value: string }[]; line: number;
}
interface Model {
  file: string; dialect: string; profile: string; inProject: boolean; rows: Row[];
  summary: {
    total: number; average: number; errors: number; warnings: number; verdict: string; unresolved: string[];
    byRule: [string, number][]; duplicateGroups: { reason: string; possible: boolean; keys: string[] }[]; syntax: number;
  };
}

const ROW_HEIGHT = 26;
const saved = vscode.getState() ?? {};
let model: Model | undefined;
let query: string = saved.query ?? '';
let preset: string = saved.preset ?? 'all';
let sortKey: keyof Row = saved.sortKey ?? 'key';
let sortAsc: boolean = saved.sortAsc ?? true;
type Tab = 'table' | 'triage' | 'health';
let tab: Tab = saved.tab ?? 'table';
let triageRule: string | undefined = saved.triageRule;
let triageKey: string | undefined = saved.triageKey;
let current: string | undefined = saved.current;
const selected = new Set<string>();
let visible: Row[] = [];

const COLUMNS: { key: keyof Row; label: string; width: string }[] = [
  { key: 'key', label: 'Key', width: '14%' },
  { key: 'type', label: 'Type', width: '9%' },
  { key: 'author', label: 'Authors', width: '18%' },
  { key: 'title', label: 'Title', width: '24%' },
  { key: 'year', label: 'Year', width: '6%' },
  { key: 'venue', label: 'Venue', width: '12%' },
  { key: 'cited', label: 'Cited', width: '5%' },
  { key: 'score', label: 'Score', width: '9%' },
];

document.body.innerHTML = `
<div id="top">
  <input id="query" type="search" placeholder="author:knuth year:>1980 missing:doi   or any text">
  <span id="dialect" class="chip"></span>
  <select id="profile" title="Checking profile">
    <option value="minimal">Profile: Minimal</option>
    <option value="standard">Profile: Standard</option>
    <option value="strict">Profile: Strict</option>
  </select>
  <button id="scan">Scan</button>
  <span class="tabs"><button id="tabTable" class="tab">Table</button><button id="tabTriage" class="tab">Triage</button><button id="tabHealth" class="tab">Health</button></span>
</div>
<div id="presets"></div>
<div id="bulk" hidden></div>
<div id="tableView">
  <div id="thead"></div>
  <div id="tbody"><div id="spacer"></div><div id="rows"></div></div>
  <div id="drawer" hidden></div>
</div>
<div id="triageView" hidden></div>
<div id="healthView" hidden></div>`;

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const persist = () => vscode.setState({ query, preset, sortKey, sortAsc, tab, current, triageRule, triageKey });

// ---------- filtering ----------
const PRESETS: { id: string; label: string; test: (r: Row) => boolean; alert?: boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'incomplete', label: 'Incomplete', test: (r) => r.incomplete },
  { id: 'issues', label: 'With issues', test: (r) => r.issues > 0 },
  { id: 'uncited', label: 'Uncited', test: (r) => r.cited === 0 },
  { id: 'duplicates', label: 'Duplicates', test: (r) => r.duplicate, alert: true },
  { id: 'missingDoi', label: 'Missing DOI', test: (r) => r.missingDoi },
];

/** Field-scoped query: `author:knuth`, `year:>1980`, `missing:doi`, `type:book`, plus free text. */
function matches(row: Row, q: string): boolean {
  for (const token of q.match(/\S+:"[^"]*"|\S+/g) ?? []) {
    const m = /^(\w+):(.*)$/.exec(token);
    if (!m) {
      const t = token.toLowerCase();
      if (![row.key, row.author, row.title, row.venue, row.year].some((v) => v.toLowerCase().includes(t))) return false;
      continue;
    }
    const [, field, rawValue] = m;
    const value = rawValue.replace(/^"|"$/g, '').toLowerCase();
    if (field === 'missing') {
      if (row.fields.some((f) => f.name === value && f.value.trim())) return false;
      continue;
    }
    if (field === 'is') {
      const p = PRESETS.find((x) => x.id.toLowerCase() === value);
      if (p && !p.test(row)) return false;
      continue;
    }
    const cmp = /^([<>]=?)(\d+)$/.exec(value);
    const fieldValue = field in row ? String((row as any)[field] ?? '') : row.fields.find((f) => f.name === field)?.value ?? '';
    if (cmp) {
      const n = parseInt(fieldValue, 10);
      const target = +cmp[2];
      const ok = cmp[1] === '>' ? n > target : cmp[1] === '>=' ? n >= target : cmp[1] === '<' ? n < target : n <= target;
      if (!ok) return false;
    } else if (!fieldValue.toLowerCase().includes(value)) return false;
  }
  return true;
}

function refilter() {
  if (!model) return;
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
  visible = model.rows.filter((r) => p.test(r) && matches(r, query));
  visible.sort((a, b) => {
    const va = a[sortKey] ?? -1;
    const vb = b[sortKey] ?? -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
    return sortAsc ? c : -c;
  });
  renderPresets();
  renderHead();
  ($('#spacer') as HTMLElement).style.height = `${visible.length * ROW_HEIGHT}px`;
  renderRows();
  persist();
}

// ---------- rendering ----------
function renderPresets() {
  const el = $('#presets');
  el.innerHTML = '<span class="muted">Saved filters:</span>';
  for (const p of PRESETS) {
    const count = model!.rows.filter(p.test).length;
    if (p.id === 'uncited' && !model!.inProject) continue;
    const chip = document.createElement('span');
    chip.className = `chip${preset === p.id ? ' active' : ''}${p.alert && count ? ' alert' : ''}`;
    chip.textContent = `${p.label} ${count}`;
    chip.onclick = () => {
      preset = p.id;
      refilter();
    };
    el.appendChild(chip);
  }
}

function renderHead() {
  const head = $('#thead');
  head.innerHTML = `<div class="cell check"></div>` + COLUMNS.map((c) => `<div class="cell" data-key="${c.key}" style="width:${c.width}">${c.label}${sortKey === c.key ? (sortAsc ? ' ▴' : ' ▾') : ''}</div>`).join('') + `<div class="cell" style="width:6%">Issues</div>`;
  head.querySelectorAll('[data-key]').forEach((el) => {
    (el as HTMLElement).onclick = () => {
      const k = (el as HTMLElement).dataset.key as keyof Row;
      sortAsc = sortKey === k ? !sortAsc : true;
      sortKey = k;
      refilter();
    };
  });
}

/** Renders only the rows that are scrolled into view. */
function renderRows() {
  const body = $('#tbody');
  const first = Math.max(0, Math.floor(body.scrollTop / ROW_HEIGHT) - 5);
  const count = Math.ceil(body.clientHeight / ROW_HEIGHT) + 10;
  const rowsEl = $('#rows');
  rowsEl.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
  rowsEl.innerHTML = visible
    .slice(first, first + count)
    .map((r) => {
      const scoreClass = r.score < 70 ? 'bar low' : 'bar';
      const issue = r.possibleDuplicate ? '<span class="badge">possible dup</span>' : r.issues ? `<span class="badge">${r.issues}</span>` : '';
      return `<div class="row${r.key === current ? ' current' : ''}${selected.has(r.key) ? ' selected' : ''}" data-key="${esc(r.key)}">
        <div class="cell check"><input type="checkbox" ${selected.has(r.key) ? 'checked' : ''}></div>
        <div class="cell mono" style="width:14%">${esc(r.key)}</div>
        <div class="cell" style="width:9%">${esc(r.type)}</div>
        <div class="cell" style="width:18%">${esc(r.author)}</div>
        <div class="cell" style="width:24%">${esc(r.title)}</div>
        <div class="cell" style="width:6%">${esc(r.year)}</div>
        <div class="cell${r.venue || !r.incomplete ? '' : ' err'}" style="width:12%">${r.venue ? esc(r.venue) : r.incomplete ? '— missing' : '<span class="muted">—</span>'}</div>
        <div class="cell${r.cited === 0 ? ' err' : ''}" style="width:5%">${r.cited ?? '–'}</div>
        <div class="cell" style="width:9%" title="${r.score}/100"><div class="${scoreClass}"><span style="width:${r.score}%"></span></div></div>
        <div class="cell" style="width:6%">${issue}</div>
      </div>`;
    })
    .join('');
  rowsEl.querySelectorAll('.row').forEach((el) => {
    const key = (el as HTMLElement).dataset.key!;
    (el.querySelector('input') as HTMLInputElement).onclick = (e) => {
      e.stopPropagation();
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      renderBulk();
      renderRows();
    };
    (el as HTMLElement).onclick = () => {
      current = key;
      vscode.postMessage({ type: 'select', key });
      renderRows();
      renderDrawer();
      persist();
    };
    (el as HTMLElement).ondblclick = () => vscode.postMessage({ type: 'openText', key });
  });
}

function renderBulk() {
  const el = $('#bulk');
  el.hidden = selected.size === 0;
  el.innerHTML = `<b>${selected.size} selected</b> | <button data-a="setField">Set field…</button><button data-a="removeField">Remove field…</button><button data-a="delete">Delete</button><button data-a="clear" class="ghost">Clear selection</button>`;
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const action = b.dataset.a!;
      if (action === 'clear') {
        selected.clear();
        renderBulk();
        renderRows();
        return;
      }
      vscode.postMessage({ type: 'bulk', action, keys: [...selected] });
    };
  });
}

function renderDrawer() {
  const drawer = $('#drawer');
  const row = model?.rows.find((r) => r.key === current);
  drawer.hidden = !row;
  if (!row) return;
  drawer.innerHTML = `
    <div class="drawer-main">
      <div class="drawer-head"><span class="mono"><b>${esc(row.key)}</b></span> <span class="chip">${esc(row.type)}</span>
        <span class="muted">score ${row.score}${row.cited !== null ? ` · cited ${row.cited}×` : ''}</span>
        <span class="grow"></span>
        <button data-act="editInForm">Edit in form</button><button data-act="addField">+ Field</button><button data-act="openText">Open in text</button><button data-act="copyKey">Copy key</button>
      </div>
      <div class="fields">${row.fields
        .map(
          (f) => `<label class="muted">${esc(f.name)}</label><div class="field"><input data-field="${esc(f.name)}" value="${esc(f.value)}"><button class="ghost remove" data-remove="${esc(f.name)}" title="Remove field">✕</button></div>`,
        )
        .join('')}</div>
    </div>
    <div class="drawer-side">
      <div class="caps">Issues</div>
      ${row.findings.length ? row.findings.map((f, i) => `<div class="issue ${f.severity}"><span>${f.severity === 'error' ? '⊗' : f.severity === 'warning' ? '⚠' : 'ⓘ'} ${esc(f.message)}</span>${f.fixable ? `<button data-fix="${i}">Fix</button>` : ''}</div>`).join('') : '<div class="muted">No issues.</div>'}
      <div class="caps" style="margin-top:10px">Cited in</div>
      ${row.citedIn.length ? row.citedIn.map((c, i) => `<a href="#" class="mono" data-loc="${i}">${esc(c.file)}:${c.line}</a>`).join('') : `<div class="muted">${row.cited === null ? 'This file is not part of the current project.' : 'Not cited.'}</div>`}
    </div>`;
  drawer.querySelectorAll('input[data-field]').forEach((el) => {
    const input = el as HTMLInputElement;
    const commit = () => {
      const original = row.fields.find((f) => f.name === input.dataset.field)?.value;
      if (input.value !== original) vscode.postMessage({ type: 'editField', key: row.key, field: input.dataset.field, value: input.value });
    };
    input.onchange = commit;
    input.onkeydown = (e) => e.key === 'Enter' && commit();
  });
  drawer.querySelectorAll('[data-remove]').forEach((b) => ((b as HTMLElement).onclick = () => vscode.postMessage({ type: 'removeField', key: row.key, field: (b as HTMLElement).dataset.remove })));
  drawer.querySelectorAll('[data-fix]').forEach((b) => {
    const f = row.findings[+(b as HTMLElement).dataset.fix!];
    (b as HTMLElement).onclick = () => vscode.postMessage({ type: 'fix', key: row.key, code: f.code, start: f.start });
  });
  drawer.querySelectorAll('[data-loc]').forEach((a) => {
    const c = row.citedIn[+(a as HTMLElement).dataset.loc!];
    (a as HTMLElement).onclick = (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openLocation', path: c.path, line: c.line });
    };
  });
  drawer.querySelectorAll('[data-act]').forEach((b) => ((b as HTMLElement).onclick = () => vscode.postMessage({ type: (b as HTMLElement).dataset.act, key: row.key })));
}

function renderHealth() {
  const s = model!.summary;
  const least = [...model!.rows].sort((a, b) => a.score - b.score).slice(0, 8);
  const el = $('#healthView');
  el.innerHTML = `
    <div class="health-head">
      <div><div class="muted">Profile: ${model!.profile} · ${model!.dialect} · ${s.total} entries</div>
      <div class="big">${s.average} / 100 <span class="${s.verdict === 'PASS' ? 'ok' : 'err'}">${s.verdict}</span></div></div>
      <span class="grow"></span>
      <button data-export="md">Export Markdown</button><button data-export="csv">CSV</button><button data-export="json">JSON</button>
      ${s.byRule.some(([c]) => ['bib/page-range', 'bib/doi-url', 'bib/et-al'].includes(c)) ? '<button class="primary" id="fixSafe">Fix all safe</button>' : ''}
    </div>
    <div class="stats">
      <div><div class="muted">Errors</div><div class="big err">${s.errors}</div></div>
      <div><div class="muted">Warnings</div><div class="big">${s.warnings}</div></div>
      <div><div class="muted">Unresolved cites</div><div class="big ${s.unresolved.length ? 'err' : ''}">${s.unresolved.length}</div></div>
      <div><div class="muted">Duplicate groups</div><div class="big">${s.duplicateGroups.length}</div></div>
    </div>
    <div class="cols">
      <div><div class="caps">Most common problems</div>${s.byRule.map(([c, n]) => `<div class="line" data-q="${esc(c)}"><span class="mono">${esc(c)}</span><b>${n}</b></div>`).join('') || '<div class="muted">None</div>'}</div>
      <div><div class="caps">Least complete entries</div>${least.map((r) => `<div class="line" data-key="${esc(r.key)}"><span class="mono">${esc(r.key)}</span><b>${r.score}</b></div>`).join('')}</div>
    </div>
    <div class="caps" style="margin-top:14px">Duplicates · unresolved</div>
    ${s.duplicateGroups.map((g) => `<div class="line"><span class="mono">${g.keys.map(esc).join(' ↔ ')}</span><span class="muted">${g.possible ? 'possible · ' : ''}${esc(g.reason)}</span></div>`).join('')}
    ${s.unresolved.map((k) => `<div class="line"><span class="mono err">${esc(k)}</span><span class="muted">cited but not in any bibliography</span></div>`).join('')}
    ${!s.duplicateGroups.length && !s.unresolved.length ? '<div class="muted">None found.</div>' : ''}
    <p class="muted small">Score = 70 × share of required fields + 20 × share of recommended fields (profile) + 10 × value quality. Fuzzy duplicates are always marked "possible".</p>`;
  el.querySelectorAll('[data-export]').forEach((b) => ((b as HTMLElement).onclick = () => vscode.postMessage({ type: 'export', format: (b as HTMLElement).dataset.export })));
  const fix = el.querySelector('#fixSafe') as HTMLElement | null;
  if (fix) fix.onclick = () => vscode.postMessage({ type: 'fixAllSafe' });
  el.querySelectorAll('[data-key]').forEach((d) => {
    (d as HTMLElement).onclick = () => {
      current = (d as HTMLElement).dataset.key;
      setTab('table');
      renderDrawer();
    };
  });
}

// ---------- triage: one rule at a time ----------
const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };

function triageQueue() {
  const byRule = new Map<string, { severity: string; items: { row: Row; finding: Finding }[] }>();
  for (const row of model!.rows) {
    for (const finding of row.findings) {
      const group = byRule.get(finding.code) ?? { severity: finding.severity, items: [] };
      group.items.push({ row, finding });
      byRule.set(finding.code, group);
    }
  }
  return [...byRule].sort((a, b) => SEVERITY_ORDER[a[1].severity] - SEVERITY_ORDER[b[1].severity] || b[1].items.length - a[1].items.length);
}

/** The entry as it would look with its missing fields marked, so the user sees what a fix adds. */
function entryPreview(row: Row, finding: Finding): string {
  const lines = row.fields.map((f) => `  ${esc(f.name)} = {${esc(f.value)}},`);
  for (const name of finding.missing ?? []) lines.push(`  <span class="err">${esc(name)} = ⟨missing⟩</span>`);
  return `@${esc(row.type)}{${esc(row.key)},\n${lines.join('\n')}\n}`;
}

function renderTriage() {
  const el = $('#triageView');
  const s = model!.summary;
  const queue = triageQueue();
  if (!queue.some(([code]) => code === triageRule)) triageRule = queue[0]?.[0];
  const group = queue.find(([code]) => code === triageRule)?.[1];
  const items = group?.items ?? [];
  if (!items.some((i) => i.row.key === triageKey)) triageKey = items[0]?.row.key;
  const pick = items.find((i) => i.row.key === triageKey);
  if (triageKey) vscode.postMessage({ type: 'select', key: triageKey });
  const safeCount = model!.rows.reduce((n, r) => n + r.findings.filter((f) => f.safe).length, 0);

  el.innerHTML = `
    <div class="triage-head">
      <span>${s.total} entries · ${s.average}/100 · ${esc(model!.profile)}: <b class="${s.verdict === 'PASS' ? 'ok' : 'err'}">${s.verdict}</b></span>
      <span class="grow"></span>
      ${safeCount ? `<button class="primary" id="triageFixSafe" title="Only deterministic fixes: page ranges, DOI URLs, et al.">Fix all safe (${safeCount})</button>` : ''}
    </div>
    <div class="triage-cols">
      <div class="triage-rules"><div class="caps">By rule</div>
        ${queue.map(([code, g]) => `<div class="line${code === triageRule ? ' active' : ''}" data-rule="${esc(code)}"><span class="mono ${g.severity}">${esc(code)}</span><b>${g.items.length}</b></div>`).join('') || '<div class="muted">No problems found.</div>'}
      </div>
      <div class="triage-entries"><div class="caps">Entries (${items.length})</div>
        ${items.map(({ row, finding }) => `<div class="line${row.key === triageKey ? ' active' : ''}" data-entry="${esc(row.key)}"><span class="mono">${esc(row.key)}</span><span class="muted">${esc(finding.missing?.join(', ') ?? finding.message)}</span></div>`).join('')}
      </div>
      <div class="triage-detail">${pick ? triageDetail(pick.row, pick.finding) : ''}</div>
    </div>`;

  el.querySelectorAll('[data-rule]').forEach((d) => ((d as HTMLElement).onclick = () => {
    triageRule = (d as HTMLElement).dataset.rule;
    triageKey = undefined;
    renderTriage();
    persist();
  }));
  el.querySelectorAll('[data-entry]').forEach((d) => ((d as HTMLElement).onclick = () => {
    triageKey = (d as HTMLElement).dataset.entry;
    renderTriage();
    persist();
  }));
  const fixSafe = el.querySelector('#triageFixSafe') as HTMLElement | null;
  if (fixSafe) fixSafe.onclick = () => vscode.postMessage({ type: 'fixAllSafe' });
  if (!pick) return;
  const post = (type: string) => vscode.postMessage({ type, key: pick.row.key, code: pick.finding.code, start: pick.finding.start });
  el.querySelectorAll('[data-triage]').forEach((b) => ((b as HTMLElement).onclick = () => {
    const action = (b as HTMLElement).dataset.triage!;
    if (action === 'next') {
      const i = items.findIndex((x) => x.row.key === triageKey);
      triageKey = items[(i + 1) % items.length]?.row.key;
      renderTriage();
      persist();
    } else post(action);
  }));
}

function triageDetail(row: Row, finding: Finding): string {
  const fixLabel = finding.missing ? `Insert empty ${finding.missing.map((m) => `"${esc(m)}"`).join(', ')}` : finding.replacement !== undefined ? `Change to "${esc(finding.replacement)}"` : '';
  return `
    <div class="muted">${esc(finding.message)}</div>
    <pre class="entry-preview">${entryPreview(row, finding)}</pre>
    <div class="caps">Fix</div>
    <div class="triage-actions">
      ${finding.fixable ? `<button class="primary" data-triage="fix">${fixLabel}</button>` : ''}
      <button data-triage="suppress" title="Adds a % bib-ignore comment above the entry">Suppress for entry</button>
      <button data-triage="openText">Open in text</button>
      <button data-triage="next">Next issue ›</button>
    </div>`;
}

function setTab(t: Tab) {
  tab = t;
  $('#tableView').hidden = t !== 'table';
  $('#triageView').hidden = t !== 'triage';
  $('#healthView').hidden = t !== 'health';
  $('#tabTable').classList.toggle('active', t === 'table');
  $('#tabTriage').classList.toggle('active', t === 'triage');
  $('#tabHealth').classList.toggle('active', t === 'health');
  if (t === 'health' && model) renderHealth();
  if (t === 'triage' && model) renderTriage();
  if (t === 'table') renderRows();
  persist();
}

// ---------- wiring ----------
const queryInput = $('#query') as HTMLInputElement;
queryInput.value = query;
queryInput.oninput = () => {
  query = queryInput.value;
  refilter();
};
($('#profile') as HTMLSelectElement).onchange = (e) => vscode.postMessage({ type: 'setProfile', profile: (e.target as HTMLSelectElement).value });
$('#scan').onclick = () => vscode.postMessage({ type: 'scan' });
$('#tabTable').onclick = () => setTab('table');
$('#tabHealth').onclick = () => setTab('health');
$('#tabTriage').onclick = () => setTab('triage');
$('#tbody').addEventListener('scroll', () => requestAnimationFrame(renderRows));
window.addEventListener('resize', () => renderRows());

window.addEventListener('message', (event) => {
  if (event.data.type !== 'data') return;
  model = event.data.model as Model;
  $('#dialect').textContent = model.dialect === 'biblatex' ? 'BibLaTeX' : 'BibTeX';
  ($('#profile') as HTMLSelectElement).value = model.profile;
  for (const k of [...selected]) if (!model.rows.some((r) => r.key === k)) selected.delete(k);
  refilter();
  renderBulk();
  renderDrawer();
  if (tab === 'health') renderHealth();
  if (tab === 'triage') renderTriage();
});

setTab(tab);
vscode.postMessage({ type: 'ready' });
