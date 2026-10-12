// Entry form webview: required, recommended, optional and other fields of one .bib entry.
export {};
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface Problem { message: string; code: string; start: number; fixable: boolean }
interface EntryMsg {
  entry: { key: string; type: string; fields: { name: string; value: string }[] };
  types: string[];
  groups: { required: string[]; recommended: string[]; optional: string[] };
  problems: Record<string, Problem[]>;
  profile: string;
  file: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const app = document.getElementById('app')!;
let shownKey: string | undefined;
let optionalOpen = false;

/** "author|editor" -> the alternative that is present in the entry, or the first one. */
function pickName(spec: string, present: Set<string>): string {
  const names = spec.split('|');
  return names.find((n) => present.has(n)) ?? names[0];
}

function render(msg: EntryMsg) {
  const { entry, groups, problems } = msg;
  const values = new Map(entry.fields.map((f) => [f.name, f.value]));
  const present = new Set(values.keys());
  const used = new Set<string>();

  const fieldRow = (spec: string, required: boolean) => {
    const name = pickName(spec, present);
    spec.split('|').forEach((n) => used.add(n));
    const label = spec.split('|').join(' / ');
    const value = values.get(name);
    const notes = (problems[name] ?? [])
      .map((p) => `<div class="note">${esc(p.message)}${p.fixable ? ` · <a href="#" data-fix="${esc(p.code)}" data-start="${p.start}">Fix</a>` : ''}</div>`)
      .join('');
    return `<label>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>
      <div class="value">
        <input data-field="${esc(name)}" value="${esc(value ?? '')}" placeholder="${value === undefined ? 'empty' : ''}" class="${value === undefined && required ? 'missing' : ''}">
        ${notes}
      </div>`;
  };

  const required = groups.required.map((f) => fieldRow(f, true)).join('');
  const recommended = groups.recommended.filter((f) => !f.split('|').some((n) => used.has(n))).map((f) => fieldRow(f, false)).join('');
  const optionalSpecs = groups.optional.filter((f) => !f.split('|').some((n) => used.has(n)));
  // Optional fields that already have a value are shown even when the section is collapsed.
  const optionalFilled = optionalSpecs.filter((f) => f.split('|').some((n) => present.has(n)));
  const optional = (optionalOpen ? optionalSpecs : optionalFilled).map((f) => fieldRow(f, false)).join('');
  const other = entry.fields.filter((f) => !used.has(f.name));

  app.innerHTML = `
    <header>
      <span class="key mono">${esc(entry.key.toUpperCase())}</span>
      <select id="type">${msg.types.map((t) => `<option${t === entry.type ? ' selected' : ''}>${esc(t)}</option>`).join('')}${msg.types.includes(entry.type) ? '' : `<option selected>${esc(entry.type)}</option>`}</select>
      <span class="grow"></span>
      <button id="openText" class="ghost">Open in text</button>
    </header>
    ${(problems._entry ?? []).map((p) => `<div class="note entry-note">${esc(p.message)}${p.fixable ? ` · <a href="#" data-fix="${esc(p.code)}" data-start="${p.start}">Fix</a>` : ''}</div>`).join('')}
    <section><div class="caps">Required</div><div class="grid">${required || '<span class="muted">No required fields for this type.</span>'}</div></section>
    ${recommended ? `<section><div class="caps">Recommended (${esc(msg.profile)})</div><div class="grid">${recommended}</div></section>` : ''}
    <section><div class="caps toggle" id="optToggle">${optionalOpen ? '▾' : '▸'} Optional (${optionalSpecs.length})</div><div class="grid">${optional}</div></section>
    <section><div class="caps">Other fields</div><div class="grid">${other
      .map((f) => `<label class="mono">${esc(f.name)}</label><div class="value row"><input data-field="${esc(f.name)}" value="${esc(f.value)}"><button class="ghost" data-remove="${esc(f.name)}" title="Remove field">✕</button></div>`)
      .join('')}</div>
      <div class="add"><input id="newField" placeholder="add field, e.g. keywords"><button id="addField">Add</button></div>
    </section>`;

  app.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
    // Commit after a short pause in typing, and on Enter / blur.
    let timer: number | undefined;
    const commit = () => {
      clearTimeout(timer);
      const name = input.dataset.field!;
      // Unchanged values (including a still-empty missing field) make no edit.
      if (input.value === (values.get(name) ?? '')) return;
      vscode.postMessage({ type: 'set', field: name, value: input.value });
      values.set(name, input.value);
    };
    input.oninput = () => {
      clearTimeout(timer);
      timer = window.setTimeout(commit, 500);
    };
    input.onblur = commit;
    input.onkeydown = (e) => e.key === 'Enter' && commit();
  });
  app.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => (b.onclick = () => vscode.postMessage({ type: 'remove', field: b.dataset.remove })));
  app.querySelectorAll<HTMLElement>('[data-fix]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'fix', code: a.dataset.fix, start: Number(a.dataset.start) });
  }));
  (document.getElementById('type') as HTMLSelectElement).onchange = (e) => vscode.postMessage({ type: 'changeType', value: (e.target as HTMLSelectElement).value });
  document.getElementById('openText')!.onclick = () => vscode.postMessage({ type: 'openText' });
  document.getElementById('optToggle')!.onclick = () => {
    optionalOpen = !optionalOpen;
    render(msg);
  };
  const addField = () => {
    const input = document.getElementById('newField') as HTMLInputElement;
    const name = input.value.trim().toLowerCase();
    if (/^[a-z][\w-]*$/.test(name)) vscode.postMessage({ type: 'add', field: name });
  };
  document.getElementById('addField')!.onclick = addField;
  (document.getElementById('newField') as HTMLInputElement).onkeydown = (e) => e.key === 'Enter' && addField();
}

/** Text-side changes refresh the form without disturbing the field being typed in. */
function update(msg: EntryMsg) {
  const focused = document.activeElement as HTMLInputElement | null;
  const focusedField = focused?.dataset?.field;
  if (msg.entry.key !== shownKey || !focusedField) {
    shownKey = msg.entry.key;
    render(msg);
    return;
  }
  const caret = focused!.selectionStart;
  const typed = focused!.value;
  render(msg);
  const again = app.querySelector<HTMLInputElement>(`input[data-field="${CSS.escape(focusedField)}"]`);
  if (again) {
    again.value = typed;
    again.focus();
    if (caret !== null) again.setSelectionRange(caret, caret);
  }
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'entry') update(msg);
  if (msg.type === 'empty') {
    shownKey = undefined;
    app.innerHTML = '<p class="muted">Place the cursor inside an entry of a .bib file.</p>';
  }
});
vscode.postMessage({ type: 'ready' });
