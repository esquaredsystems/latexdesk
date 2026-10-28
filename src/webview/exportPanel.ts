// Export for submission webview: preset and options on the left, checks and package on the right.
export {};
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface State {
  preset: string;
  options: Record<string, boolean>;
  verify: boolean;
  files: { target: string; size: number; changed: boolean }[];
  totalBytes: number;
  checks: { level: string; message: string }[];
  notes: string[];
  result?: { ok: boolean; message: string; target?: string; dir?: string };
  busy?: string;
}

const OPTIONS: [string, string][] = [
  ['allSourceFiles', 'Every source file in the folder (no PDF or build files)'],
  ['usedFilesOnly', 'Only files actually used (from .fls)'],
  ['flatten', 'Flatten \\input / \\include'],
  ['includeBbl', 'Include pre-generated .bbl'],
  ['stripComments', 'Strip comments'],
  ['includePdf', 'Include compiled PDF'],
  ['manifest', 'Add manifest'],
];
const PRESETS: [string, string][] = [
  ['arxiv', 'arXiv'],
  ['journal', 'Journal'],
  ['project', 'Source ZIP'],
  ['custom', 'Custom'],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ICON: Record<string, string> = { ok: '✓', warning: '⚠', error: '⊗' };
const app = document.getElementById('app')!;

function render(s: State) {
  app.innerHTML = `
    <h2>Export for submission</h2>
    <div class="cols">
      <div class="left">
        <div class="caps">Preset</div>
        <div class="presets">${PRESETS.map(([id, label]) => `<button class="${s.preset === id ? 'active' : ''}" data-preset="${id}">${label}</button>`).join('')}</div>
        ${OPTIONS.map(([id, label]) => `<label><input type="checkbox" data-option="${id}" ${s.options[id] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
        <label class="verify"><input type="checkbox" id="verify" ${s.verify ? 'checked' : ''}> Verify: compile the copy in a temporary folder</label>
        <p class="muted small">Always uses the files of the last full build, never a fast preview.</p>
      </div>
      <div class="right">
        <div class="caps">Checks</div>
        ${s.checks.map((c) => `<div class="check ${c.level}">${ICON[c.level]} ${esc(c.message)}</div>`).join('') || '<div class="muted">No problems found.</div>'}
        ${s.notes.map((n) => `<div class="check note">ⓘ ${esc(n)}</div>`).join('')}
        <div class="caps package">Package · ${s.files.length} files · ${mb(s.totalBytes)}</div>
        <div class="files">${s.files.map((f) => `<div><span class="mono">${esc(f.target)}</span><span class="muted">${f.changed ? 'rewritten · ' : ''}${mb(f.size)}</span></div>`).join('')}</div>
        ${s.result ? `<div class="result ${s.result.ok ? 'ok' : 'error'}">${s.result.ok ? '✓' : '⊗'} ${esc(s.result.message)}
          ${s.result.target ? `<a href="#" data-reveal="${esc(s.result.target)}">Show export</a>` : ''}
          ${s.result.dir ? `<a href="#" data-reveal="${esc(s.result.dir)}">Open failed build folder</a>` : ''}</div>` : ''}
        ${s.busy ? `<div class="busy">${esc(s.busy)}</div>` : ''}
        <div class="actions"><button class="primary" data-export="zip" ${s.busy ? 'disabled' : ''}>Export ZIP</button><button data-export="folder" ${s.busy ? 'disabled' : ''}>Export folder</button></div>
      </div>
    </div>`;
  app.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => (b.onclick = () => vscode.postMessage({ type: 'preset', preset: b.dataset.preset })));
  app.querySelectorAll<HTMLInputElement>('[data-option]').forEach((c) => (c.onchange = () => vscode.postMessage({ type: 'option', name: c.dataset.option, value: c.checked })));
  (document.getElementById('verify') as HTMLInputElement).onchange = (e) => vscode.postMessage({ type: 'verify', value: (e.target as HTMLInputElement).checked });
  app.querySelectorAll<HTMLElement>('[data-export]').forEach((b) => (b.onclick = () => vscode.postMessage({ type: 'export', format: b.dataset.export })));
  app.querySelectorAll<HTMLElement>('[data-reveal]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'reveal', path: a.dataset.reveal });
  }));
}

window.addEventListener('message', (e) => render(e.data as State));
vscode.postMessage({ type: 'ready' });
