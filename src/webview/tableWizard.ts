// Table wizard webview: grid on top, options and live LaTeX preview below.
import { generateTable, requiredPackages, TableEnv, TableModel } from '../core/table';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const COLUMN_TYPES = ['l', 'c', 'r', 'p{3cm}', 'X', 'S'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const app = document.getElementById('app')!;
let model: TableModel | undefined;
let note = '';
let loaded = new Set<string>();
/** Selected cell, used by "− Row" / "− Col". */
let selected = { row: 0, col: 0 };

function render() {
  if (!model) return;
  const m = model;
  app.innerHTML = `
    <div class="toolbar">
      <select id="env">${(['tabular', 'tabularx', 'longtable'] as TableEnv[]).map((e) => `<option${e === m.env ? ' selected' : ''}>${e}</option>`).join('')}</select>
      <label><input type="checkbox" id="booktabs" ${m.booktabs ? 'checked' : ''}> booktabs</label>
      <label><input type="checkbox" id="header" ${m.header ? 'checked' : ''}> header row</label>
      <span class="sep"></span>
      <button data-act="addRow">+ Row</button><button data-act="addCol">+ Col</button>
      <button data-act="delRow">− Row</button><button data-act="delCol">− Col</button>
      <span class="sep"></span>
      <button data-act="paste">Paste from spreadsheet</button><button data-act="importCsv">Import CSV</button><button data-act="exportCsv">Export CSV</button>
    </div>
    <div class="gridwrap"><table class="grid">
      <tr><th></th>${m.columns.map((c, j) => `<th><select data-col="${j}">${[...new Set([...COLUMN_TYPES, c])].map((t) => `<option${t === c ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></th>`).join('')}</tr>
      ${m.rows
        .map(
          (row, i) =>
            `<tr class="${i === 0 && m.header ? 'head' : ''}"><th class="muted">${i + 1}</th>${row
              .map((cell, j) => `<td><input data-r="${i}" data-c="${j}" value="${esc(cell)}" class="${selected.row === i && selected.col === j ? 'sel' : ''}"></td>`)
              .join('')}</tr>`,
        )
        .join('')}
    </table></div>
    <div class="options">
      <label><input type="checkbox" id="float" ${m.float ? 'checked' : ''}> table float</label>
      <label>Placement <input id="placement" value="${esc(m.placement)}" size="4"></label>
      ${m.env === 'tabularx' ? `<label>Width <input id="width" value="${esc(m.width)}" size="10"></label>` : ''}
      <label class="wide">Caption <input id="caption" value="${esc(m.caption)}"></label>
      <label>Label <input id="label" value="${esc(m.label)}" class="mono"></label>
    </div>
    <pre class="preview" id="preview"></pre>
    <div class="footer">
      <span class="muted">${esc(note)}</span>
      <span id="pkgNote" class="note"></span>
      <span class="grow"></span>
      <button class="primary" id="write">Write to document</button>
    </div>`;
  wire();
  updatePreview();
}

function updatePreview() {
  if (!model) return;
  document.getElementById('preview')!.textContent = generateTable(model);
  const missing = requiredPackages(model).filter((p) => !loaded.has(p));
  document.getElementById('pkgNote')!.textContent = missing.length ? `Adds \\usepackage{${missing.join(',')}} — you will be asked` : '';
}

function wire() {
  const m = model!;
  app.querySelectorAll<HTMLInputElement>('input[data-r]').forEach((input) => {
    input.oninput = () => {
      m.rows[+input.dataset.r!][+input.dataset.c!] = input.value;
      updatePreview();
    };
    input.onfocus = () => (selected = { row: +input.dataset.r!, col: +input.dataset.c! });
    // Enter moves down, Tab moves right (the browser default), like a spreadsheet.
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const next = app.querySelector<HTMLInputElement>(`input[data-r="${+input.dataset.r! + 1}"][data-c="${input.dataset.c}"]`);
        next?.focus();
      }
    };
  });
  app.querySelectorAll<HTMLSelectElement>('select[data-col]').forEach((sel) => (sel.onchange = () => {
    m.columns[+sel.dataset.col!] = sel.value;
    updatePreview();
  }));
  const bind = (id: string, apply: (el: HTMLInputElement) => void, rerender = false) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.oninput = el.onchange = () => {
      apply(el);
      if (rerender) render();
      else updatePreview();
    };
  };
  bind('booktabs', (el) => (m.booktabs = el.checked));
  bind('header', (el) => (m.header = el.checked), true);
  bind('float', (el) => (m.float = el.checked));
  bind('placement', (el) => (m.placement = el.value));
  bind('width', (el) => (m.width = el.value));
  bind('caption', (el) => (m.caption = el.value));
  bind('label', (el) => (m.label = el.value));
  (document.getElementById('env') as HTMLSelectElement).onchange = (e) => {
    m.env = (e.target as HTMLSelectElement).value as TableEnv;
    render();
  };
  app.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act!)));
  document.getElementById('write')!.onclick = () => vscode.postMessage({ type: 'write', model: m });
}

function act(action: string) {
  const m = model!;
  const cols = m.columns.length;
  switch (action) {
    case 'addRow':
      m.rows.splice(selected.row + 1, 0, Array(cols).fill(''));
      break;
    case 'addCol':
      m.columns.splice(selected.col + 1, 0, 'l');
      m.rows.forEach((r) => r.splice(selected.col + 1, 0, ''));
      break;
    case 'delRow':
      if (m.rows.length > 1) m.rows.splice(selected.row, 1);
      selected.row = Math.min(selected.row, m.rows.length - 1);
      break;
    case 'delCol':
      if (cols > 1) {
        m.columns.splice(selected.col, 1);
        m.rows.forEach((r) => r.splice(selected.col, 1));
      }
      selected.col = Math.min(selected.col, m.columns.length - 1);
      break;
    case 'paste':
    case 'importCsv':
      vscode.postMessage({ type: action });
      return;
    case 'exportCsv':
      vscode.postMessage({ type: 'exportCsv', model: m });
      return;
  }
  render();
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'model') {
    model = msg.model;
    note = msg.note;
    loaded = new Set(msg.loadedPackages);
    selected = { row: 0, col: 0 };
    render();
  } else if (msg.type === 'rows' && model) {
    model.rows = msg.rows;
    model.columns = Array(msg.rows[0]?.length ?? 1).fill('l');
    note = `${msg.rows.length} rows pasted`;
    render();
  }
});
vscode.postMessage({ type: 'ready' });
