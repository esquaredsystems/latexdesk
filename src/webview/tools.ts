// LaTeX Tools mini bar: format, alignment, size, equation and symbol buttons.
export {};
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): any; setState(s: unknown): void };
const vscode = acquireVsCodeApi();

type SymbolEntry = [string, string, string, string, string];
let symbols: SymbolEntry[] = [];
let recent: string[] = [];
let category: string = vscode.getState()?.category ?? 'Greek';
let query = '';

/** Small line drawings for the alignment buttons: which lines are short and where they sit. */
const alignIcon = (kind: 'left' | 'center' | 'right' | 'justify') => {
  const widths = [12, 8, 12, 6];
  const lines = widths
    .map((w, i) => {
      const width = kind === 'justify' ? 12 : w;
      const x = kind === 'left' || kind === 'justify' ? 2 : kind === 'right' ? 14 - width : 8 - width / 2;
      return `<line x1="${x}" y1="${3 + i * 3.3}" x2="${x + width}" y2="${3 + i * 3.3}"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">${lines}</svg>`;
};

const FORMAT: [string, string, string][] = [
  ['bold', '<b>B</b>', 'Bold (\\textbf)'],
  ['italic', '<i>I</i>', 'Italic (\\textit)'],
  ['underline', '<u>U</u>', 'Underline (\\underline)'],
  ['strikeout', '<s>S</s>', 'Strikeout (\\sout, ulem package)'],
];
const ALIGN: ['left' | 'center' | 'right' | 'justify', string][] = [
  ['left', 'Align left (flushleft)'],
  ['center', 'Centre (center)'],
  ['right', 'Align right (flushright)'],
  ['justify', 'Justify (justify, ragged2e package)'],
];
const EQUATIONS: [string, string, string][] = [
  ['inline', '$x$', 'Inline math $…$'],
  ['display', '\\[ \\]', 'Display math \\[…\\]'],
  ['equation', '(1)', 'Numbered equation'],
  ['align', '&amp;=', 'Aligned equations (align)'],
  ['frac', '<sup>a</sup>⁄<sub>b</sub>', 'Fraction'],
  ['sqrt', '√x', 'Square root'],
  ['sup', 'x<sup>n</sup>', 'Superscript'],
  ['sub', 'x<sub>n</sub>', 'Subscript'],
  ['sum', '∑', 'Sum with limits'],
  ['int', '∫', 'Integral with limits'],
  ['lim', 'lim', 'Limit'],
  ['paren', '( )', 'Auto-sized parentheses \\left( \\right)'],
  ['text', 'Tt', 'Text inside math (\\text)'],
  ['cases', '{⋮', 'Cases'],
];

/** The main toolbar: [command, icon, tooltip]; 'part'/'label' open a list. */
const TOOLBAR: [string, string, string][][] = [
  [
    ['latexdesk.tb.undo', 'undo', 'Undo'],
    ['latexdesk.tb.redo', 'redo', 'Redo'],
    ['latexdesk.tb.cut', 'cut', 'Cut'],
    ['latexdesk.tb.copy', 'copy', 'Copy'],
    ['latexdesk.tb.paste', 'paste', 'Paste'],
  ],
  [
    ['latexdesk.tb.compile', 'compile', 'Compile'],
    ['latexdesk.tb.buildView', 'build-view', 'Build & View'],
    ['latexdesk.tb.log', 'log', 'View log'],
    ['part', 'part', 'Part: \\part, \\chapter, \\section …'],
    ['label', 'label', 'Label: \\label, \\ref, \\cite …'],
  ],
  [
    ['latexdesk.table.addRow', 'add-row', 'Add table row'],
    ['latexdesk.table.deleteRow', 'delete-row', 'Delete table row'],
    ['latexdesk.table.addColumn', 'add-column', 'Add table column'],
    ['latexdesk.table.deleteColumn', 'delete-column', 'Delete table column'],
    ['latexdesk.format.highlight', 'highlight', 'Highlight (\\hl, soul package)'],
    ['latexdesk.tb.comment', 'comment', 'Comment / uncomment lines'],
  ],
];
const LISTS: Record<string, string[]> = {
  part: ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'],
  label: ['label', 'ref', 'eqref', 'pageref', 'cref', 'cite'],
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const app = document.getElementById('app')!;
app.innerHTML = `
  <section class="mainbar">
    ${TOOLBAR.map((group) => `<div class="row">${group.map(([id, icon, title]) => `<button class="tool icon" data-run="${id}" data-icon="${icon}" title="${esc(title)}"></button>`).join('')}</div>`).join('')}
    <div id="menu" class="menu" hidden></div>
  </section>
  <section>
    <div class="caps">Format</div>
    <div class="row">${FORMAT.map(([id, label, title]) => `<button class="tool" data-cmd="latexdesk.format.${id}" title="${title}">${label}</button>`).join('')}</div>
    <div class="row">${ALIGN.map(([id, title]) => `<button class="tool" data-cmd="latexdesk.format.align.${id}" title="${title}">${alignIcon(id)}</button>`).join('')}</div>
    <div class="row">
      <button class="tool" data-cmd="latexdesk.format.larger" title="Larger text (\\large, \\Large, …)">A<sup>+</sup></button>
      <button class="tool" data-cmd="latexdesk.format.smaller" title="Smaller text (\\small, \\footnotesize, …)">A<sup>−</sup></button>
      <button class="tool" data-cmd="latexdesk.format.highlight" title="Highlight (\\hl, soul package)"><span class="hl">ab</span></button>
    </div>
  </section>
  <section>
    <div class="caps">Equation</div>
    <div class="row wrap">${EQUATIONS.map(([id, label, title]) => `<button class="tool" data-eq="${id}" title="${esc(title)}">${label}</button>`).join('')}</div>
    <div class="matrix" title="Matrix: rows × columns">
      <input id="rows" type="number" min="1" max="9" value="2" aria-label="Rows">×<input id="cols" type="number" min="1" max="9" value="2" aria-label="Columns">
      <select id="mkind" aria-label="Brackets"><option value="pmatrix">( )</option><option value="bmatrix">[ ]</option><option value="vmatrix">| |</option><option value="matrix">none</option></select>
      <button id="matrixBtn" class="tool wide" title="Insert matrix">Matrix</button>
    </div>
  </section>
  <section>
    <div class="caps">Symbols</div>
    <input id="q" type="search" placeholder="Search or paste ∑">
    <select id="cat" aria-label="Category"></select>
    <div id="grid"></div>
    <div id="info" class="muted"></div>
  </section>`;

function renderSymbols() {
  const cats = ['Recent', ...new Set(symbols.map((s) => s[2]))];
  const select = document.getElementById('cat') as HTMLSelectElement;
  select.innerHTML = cats.map((c) => `<option${c === category ? ' selected' : ''}>${esc(c)}</option>`).join('');
  let list: SymbolEntry[];
  if (query) {
    const q = query.toLowerCase();
    // A pasted character finds its command; otherwise match command names and keywords.
    list = symbols.filter((s) => s[1] === query.trim() || s[0].toLowerCase().includes(q) || s[4].includes(q));
  } else if (category === 'Recent') {
    list = recent.map((c) => symbols.find((s) => s[0] === c)).filter((s): s is SymbolEntry => !!s);
  } else {
    list = symbols.filter((s) => s[2] === category);
  }
  const grid = document.getElementById('grid')!;
  grid.innerHTML = list.length
    ? list.map((s, i) => `<button class="sym" data-i="${i}" title="${esc(s[0])}${s[3] ? ` (${esc(s[3])})` : ''}">${esc(s[1])}</button>`).join('')
    : `<div class="muted">${category === 'Recent' && !query ? 'Symbols you insert appear here.' : 'No symbols found.'}</div>`;
  grid.querySelectorAll<HTMLElement>('.sym').forEach((b) => {
    const s = list[Number(b.dataset.i)];
    b.onclick = () => vscode.postMessage({ type: 'symbol', command: s[0], pkg: s[3] });
    b.onmouseenter = () => (document.getElementById('info')!.innerHTML = `<span class="mono">${esc(s[0])}</span>${s[3] ? ` <span class="muted">${esc(s[3])}</span>` : ''}`);
  });
}

// Toolbar icons follow the light or dark theme of VS Code.
function setIcons(base: string) {
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  app.querySelectorAll<HTMLElement>('[data-icon]').forEach((b) => (b.innerHTML = `<img src="${base}/${b.dataset.icon}-${dark ? 'dark' : 'light'}.svg" alt="">`));
}

function openList(kind: string, anchor: HTMLElement) {
  const menu = document.getElementById('menu')!;
  menu.innerHTML = LISTS[kind].map((name) => `<button data-insert="${name}">\\${name}</button>`).join('');
  menu.style.top = `${anchor.offsetTop + anchor.offsetHeight + 2}px`;
  menu.style.left = `${anchor.offsetLeft}px`;
  menu.hidden = false;
  menu.querySelectorAll<HTMLElement>('[data-insert]').forEach((b) => (b.onclick = () => {
    menu.hidden = true;
    vscode.postMessage({ type: 'command', id: `latexdesk.insert.${b.dataset.insert}` });
  }));
}
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#menu, [data-run="part"], [data-run="label"]')) document.getElementById('menu')!.hidden = true;
});
app.querySelectorAll<HTMLElement>('[data-run]').forEach(
  (b) => (b.onclick = () => (LISTS[b.dataset.run!] ? openList(b.dataset.run!, b) : vscode.postMessage({ type: 'command', id: b.dataset.run }))),
);
app.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => (b.onclick = () => vscode.postMessage({ type: 'command', id: b.dataset.cmd })));
app.querySelectorAll<HTMLElement>('[data-eq]').forEach((b) => (b.onclick = () => vscode.postMessage({ type: 'equation', name: b.dataset.eq })));
document.getElementById('matrixBtn')!.onclick = () =>
  vscode.postMessage({
    type: 'matrix',
    rows: Number((document.getElementById('rows') as HTMLInputElement).value) || 2,
    cols: Number((document.getElementById('cols') as HTMLInputElement).value) || 2,
    kind: (document.getElementById('mkind') as HTMLSelectElement).value,
  });
(document.getElementById('q') as HTMLInputElement).oninput = (e) => {
  query = (e.target as HTMLInputElement).value;
  renderSymbols();
};
(document.getElementById('cat') as HTMLSelectElement).onchange = (e) => {
  category = (e.target as HTMLSelectElement).value;
  vscode.setState({ category });
  renderSymbols();
};

let iconBase = '';
window.addEventListener('message', (event) => {
  if (event.data.iconBase) setIcons((iconBase = event.data.iconBase));
  if (event.data.symbols) symbols = event.data.symbols;
  if (event.data.recent) recent = event.data.recent;
  renderSymbols();
});
// Re-pick the icons when the colour theme changes.
new MutationObserver(() => iconBase && setIcons(iconBase)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
vscode.postMessage({ type: 'ready' });
