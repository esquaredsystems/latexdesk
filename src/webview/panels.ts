// Renders the dashboard, log viewer and tools panels from data sent by the extension.
export {};
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): any; setState(s: unknown): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const send = (msg: unknown) => vscode.postMessage(msg);

function wire() {
  app.querySelectorAll<HTMLElement>('[data-command]').forEach((el) => (el.onclick = () => send({ type: 'command', command: el.dataset.command })));
  app.querySelectorAll<HTMLElement>('[data-open]').forEach(
    (el) =>
      (el.onclick = (e) => {
        e.preventDefault();
        send({ type: 'open', file: el.dataset.open, line: Number(el.dataset.line) || 1 });
      }),
  );
  app.querySelectorAll<HTMLElement>('[data-msg]').forEach((el) => (el.onclick = () => send({ type: el.dataset.msg, url: el.dataset.url })));
}

// ---------------- dashboard (1d) ----------------
function dashboard(d: any) {
  if (!d.root) {
    app.innerHTML = `<div class="empty">No root document found. Open a .tex file with <code>\\documentclass</code>.</div>`;
    return;
  }
  const ago = (t?: number) => {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  const buildText = d.build.phase === 'succeeded' ? `✓ ${(d.build.durationMs / 1000).toFixed(1)} s` : d.build.phase === 'failed' ? '⊗ failed' : d.build.phase === 'building' ? 'building…' : '—';
  const snapshot = d.lastSnapshot ? new Date(d.lastSnapshot.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  app.innerHTML = `
  <div class="card dash">
    <div class="dash-head">
      <div><div class="muted">Root</div><div class="title">${esc(d.root)}</div></div>
      <span class="${d.ready ? 'chip ok-chip' : 'chip alert'}">${d.ready ? 'Ready' : `Not ready · ${d.blockers.length} blocker${d.blockers.length === 1 ? '' : 's'}`}</span>
    </div>
    <div class="grid">
      <div><div class="muted">Last build</div><div class="big">${buildText}</div><div class="muted small">${esc(d.build.recipe ?? '')} · ${ago(d.build.finishedAt)}</div></div>
      <div><div class="muted">Issues</div><div class="big ${d.issues.errors ? 'err' : ''}">${d.issues.errors} error${d.issues.errors === 1 ? '' : 's'}</div><div class="muted small">${d.issues.warnings} warning${d.issues.warnings === 1 ? '' : 's'} · ${d.issues.badBoxes} bad box${d.issues.badBoxes === 1 ? '' : 'es'}</div></div>
      <div><div class="muted">Bibliography health</div><div class="big">${d.bib.score ?? '—'}${d.bib.score !== undefined ? ' / 100' : ''}</div><div class="muted small">${d.bib.entries} entries · profile ${esc(d.bib.profile)}</div></div>
      <div><div class="muted">Words ≈</div><div class="big">${d.words.toLocaleString()}</div><div class="muted small">${d.pages ? `${d.pages} pp · ` : ''}${d.sections} § · ${d.equations} eq</div></div>
      <div><div class="muted">TODO / FIXME</div><div class="big">${d.todos}</div><div class="muted small">${esc(d.topTodo ?? '')}</div></div>
      <div><div class="muted">Last snapshot</div><div class="big">${esc(snapshot)}</div><div class="muted small">${d.lastSnapshot ? esc(d.lastSnapshot.label ? `"${d.lastSnapshot.label}"` : d.lastSnapshot.reason) + ' · ' + ago(d.lastSnapshot.time) : 'none yet'}</div></div>
    </div>
    <div class="section-title caps">Blockers</div>
    ${
      d.blockers.length
        ? d.blockers.map((b: any) => `<div class="blocker"><span class="${b.severity === 'error' ? 'err' : 'warn'}">${b.severity === 'error' ? '⊗' : '⚠'}</span> ${esc(b.text)}${b.action ? `<button data-command="${esc(b.action.command)}">${esc(b.action.label)}</button>` : ''}</div>`).join('')
        : '<div class="blocker muted">Nothing blocking.</div>'
    }
    <div class="footer"><button class="primary" data-command="latexstudio.exportSubmission">Export for submission</button><button data-command="latexstudio.history.label">Label version</button><button data-command="latexstudio.wordCount">Statistics</button><button data-command="latexstudio.build">▶ Build</button></div>
  </div>`;
  wire();
}

// ---------------- log viewer (1g) ----------------
let logFilter = new Set(['error', 'warning', 'badbox']);
let selectedIndex = 0;
function logViewer(d: any) {
  const entries: any[] = d.entries;
  if (d.focus) {
    const i = entries.findIndex((e) => e.message === d.focus);
    if (i >= 0) selectedIndex = i;
  }
  const counts = { error: 0, warning: 0, badbox: 0, info: 0 } as Record<string, number>;
  entries.forEach((e) => counts[e.severity]++);
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => logFilter.has(e.severity));
  const byFile = new Map<string, { e: any; i: number }[]>();
  for (const s of shown) byFile.set(s.e.fileLabel, [...(byFile.get(s.e.fileLabel) ?? []), s]);
  const sel = entries[selectedIndex] && logFilter.has(entries[selectedIndex].severity) ? entries[selectedIndex] : shown[0]?.e;
  const icon = (s: string) => (s === 'error' ? '<span class="err">⊗</span>' : s === 'warning' ? '<span class="warn">⚠</span>' : s === 'badbox' ? '<span class="muted">▭</span>' : 'ⓘ');
  const label = { error: 'Errors', warning: 'Warnings', badbox: 'Bad boxes', info: 'Info' } as Record<string, string>;
  app.innerHTML = `
  <div class="card log">
    <div class="log-bar">${Object.keys(label).map((k) => `<span class="chip ${logFilter.has(k) ? 'active' : ''}" data-filter="${k}">${label[k]} ${counts[k]}</span>`).join('')}
      <span class="grow"></span>${d.rawLog ? `<a href="#" data-open="${esc(d.rawLog)}" data-line="1">Raw log</a>` : ''}</div>
    <div class="log-body">
      <div class="stack"><div class="caps pad">File stack</div>
        ${
          [...byFile]
            .map(([file, list]) => `<div class="file">▾ ${esc(file)}</div>${list.map(({ e, i }) => `<div class="entry ${e === sel ? 'sel' : ''}" data-index="${i}">${icon(e.severity)} ${e.line ? `l.${e.line} ` : ''}${esc(e.message.slice(0, 80))}</div>`).join('')}`)
            .join('') || '<div class="empty">No messages for this filter. Build the project to see its log.</div>'
        }
      </div>
      <div class="detail">${sel ? detail(sel) : ''}</div>
    </div>
  </div>`;
  app.querySelectorAll<HTMLElement>('[data-filter]').forEach(
    (c) =>
      (c.onclick = () => {
        const k = c.dataset.filter!;
        if (logFilter.has(k)) logFilter.delete(k);
        else logFilter.add(k);
        logFilter = new Set(logFilter);
        logViewer(d);
      }),
  );
  app.querySelectorAll<HTMLElement>('[data-index]').forEach(
    (el) =>
      (el.onclick = () => {
        selectedIndex = Number(el.dataset.index);
        d.focus = undefined;
        logViewer(d);
      }),
  );
  wire();
}

function detail(e: any) {
  const x = e.explanation;
  const where = e.file ? `${esc(e.fileLabel)}${e.line ? `:${e.line}` : ''}` : '';
  return `
    <div><span class="chip alert">${e.tool === 'latex' ? 'LaTeX' : esc(e.tool)} ${esc(e.severity === 'badbox' ? 'bad box' : e.severity)}</span> <span class="mono muted">${where}</span></div>
    <h2>${esc(e.message)}</h2>
    ${
      x
        ? `<div class="caps">What it means</div><p>${esc(x.meaning)}</p>
           <div class="caps">Usual causes</div><ul>${x.causes.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>
           <div class="caps">Try</div><p>${esc(x.fix)}</p>`
        : '<p class="muted">No explanation available for this message.</p>'
    }
    <div class="caps">Log excerpt</div><pre>${esc(e.excerpt)}</pre>
    <div class="footer">${e.file && e.line ? `<button class="primary" data-open="${esc(e.file)}" data-line="${e.line}">Go to source</button>` : ''}</div>`;
}

// ---------------- tools (1v) ----------------
function tools(d: any) {
  const installs = [
    { label: 'TeX Live', url: 'https://tug.org/texlive/' },
    { label: 'MiKTeX', url: 'https://miktex.org/download' },
    { label: 'MacTeX', url: 'https://tug.org/mactex/' },
  ];
  app.innerHTML = `
  <div class="card tools">
    <header class="caps">Set up LaTeX Studio</header>
    ${d.trusted ? '' : '<div class="banner">Building disabled in Restricted Mode. Trust this workspace to build.</div>'}
    <div class="pad">
      ${
        d.hasEngine
          ? '<h2>A TeX distribution was found</h2><p class="muted">Everything is ready to build. Optional tools are listed below.</p>'
          : `<h2>No TeX distribution found on PATH</h2><p class="muted">Editing, completion and checks work now. Building needs a distribution.</p>
             <div class="row">${installs.map((i) => `<button data-msg="install" data-url="${i.url}">${i.label}</button>`).join('')}<span class="muted">→ opens the install guide, installs nothing</span></div>`
      }
    </div>
    <div class="section-title caps">Detected tools <button class="ghost right" data-msg="redetect">↻ Re-detect</button></div>
    <table><tr><th>Tool</th><th>Status</th><th>Path</th><th>Needed for</th></tr>
      ${d.tools
        .map((t: any) => `<tr><td class="mono">${esc(t.name)}</td><td class="${t.path ? 'ok' : t.required ? 'err' : 'muted'}">${t.path ? '✓ found' : t.required ? 'missing' : 'optional'}</td><td class="mono">${esc(t.path ?? '—')}</td><td>${esc(t.neededFor)}</td></tr>`)
        .join('')}
    </table>
    <div class="footer"><button data-msg="setPath">Set path manually…</button><button data-msg="copyReport">Copy troubleshooting report</button></div>
  </div>`;
  wire();
}

window.addEventListener('message', (event) => {
  const { kind, data } = event.data;
  if (kind === 'dashboard') dashboard(data);
  else if (kind === 'log') logViewer(data);
  else if (kind === 'tools') tools(data);
});
send({ type: 'ready' });
