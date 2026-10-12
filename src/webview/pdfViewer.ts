// PDF viewer webview, built on pdf.js and its viewer components (lazy page rendering,
// text selection, links, search). New PDFs are loaded into a second, hidden viewer and
// swapped in once the current page has rendered, so a rebuild never flashes white.
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): any; setState(s: unknown): void };
const vscode = acquireVsCodeApi();
(globalThis as any).pdfjsLib = pdfjsLib;

type ViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs');
let pdfViewerLib: ViewerModule;

interface ViewerSlot {
  container: HTMLDivElement;
  viewer: InstanceType<ViewerModule['PDFViewer']>;
  eventBus: InstanceType<ViewerModule['EventBus']>;
  linkService: InstanceType<ViewerModule['PDFLinkService']>;
  findController: InstanceType<ViewerModule['PDFFindController']>;
  doc?: PDFDocumentProxy;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
let active: ViewerSlot | undefined;
/** A forward-sync request that arrived before the PDF finished loading. */
let pendingSync: { page: number; box: { left: number; top: number; width: number; height: number } } | undefined;
let settings = { theme: 'light', reverseClick: 'ctrl-click' };
let scaleValue: string = vscode.getState()?.scale ?? 'page-width';
let layout: 'continuous' | 'single' | 'spread' = vscode.getState()?.layout ?? 'continuous';

// Read the worker location before the body is replaced by the viewer markup.
const workerUrl = (document.querySelector('meta[name="pdf-worker"]') as HTMLMetaElement).content;
document.body.innerHTML = `
<div id="toolbar">
  <button id="outlineBtn" class="ghost" title="Outline">☰</button>
  <span class="sep"></span>
  <button id="prev" class="ghost" title="Previous page">‹</button>
  <input id="pageInput" type="text" value="–" aria-label="Page">
  <span id="pageCount" class="muted">/ –</span>
  <button id="next" class="ghost" title="Next page">›</button>
  <span class="sep"></span>
  <button id="zoomOut" class="ghost" title="Zoom out">−</button>
  <select id="zoom" aria-label="Zoom">
    <option value="page-width">Fit width</option>
    <option value="page-fit">Fit page</option>
    <option value="auto">Auto</option>
    <option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option>
    <option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option>
    <option value="custom" hidden>–</option>
  </select>
  <button id="zoomIn" class="ghost" title="Zoom in">+</button>
  <select id="layout" aria-label="Layout">
    <option value="continuous">Continuous</option>
    <option value="single">Single page</option>
    <option value="spread">Two pages</option>
  </select>
  <button id="searchBtn" class="ghost" title="Search (Ctrl/Cmd+F)">⌕</button>
  <button id="themeBtn" class="ghost" title="Dark pages">◐</button>
  <span class="grow"></span>
  <span id="issues" class="issues" title="Show problems"></span>
  <div class="split">
    <button id="recompile" class="primary" title="Recompile">▶ Recompile</button><button id="menuBtn" class="primary narrow" title="Compile options">▾</button>
  </div>
</div>
<div id="progress"></div>
<div id="modeBanner" hidden></div>
<div id="banner" hidden></div>
<div id="searchBar" hidden>
  <input id="searchInput" type="search" placeholder="Find in PDF">
  <button id="searchPrev" class="ghost">‹</button><button id="searchNext" class="ghost">›</button>
  <span id="searchResult" class="muted"></span>
  <button id="searchClose" class="ghost">✕</button>
</div>
<div id="menu" class="card" hidden>
  <div class="caps menu-title">Compile options</div>
  <label><input type="checkbox" id="autoBuild"> Build on save</label>
  <label><input type="checkbox" id="fastPreview"> Fast preview (draft images)</label>
  <button class="menu-item" data-action="buildPartial">◧ Build this chapter only</button>
  <button class="menu-item" data-action="rebuild">↻ Recompile from scratch</button>
  <button class="menu-item" data-action="stop">■ Stop build</button>
  <button class="menu-item" data-action="openLog">Open log viewer</button>
  <button class="menu-item" data-action="openExternal">Open in external viewer</button>
</div>
<div id="main">
  <nav id="outline" hidden></nav>
  <div id="stage"></div>
</div>
<div id="state" hidden></div>`;

const stage = $('#stage');

async function ensureLib() {
  if (pdfViewerLib) return;
  pdfViewerLib = await import('pdfjs-dist/web/pdf_viewer.mjs');
  // Webviews cannot start workers from resource URLs directly, so load the worker as a blob.
  const source = await (await fetch(workerUrl)).text();
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(blobUrl, { type: 'module' });
}

function createSlot(): ViewerSlot {
  const container = document.createElement('div');
  container.className = 'viewerContainer';
  const inner = document.createElement('div');
  inner.className = 'pdfViewer';
  container.appendChild(inner);
  stage.appendChild(container);
  const eventBus = new pdfViewerLib.EventBus();
  const linkService = new pdfViewerLib.PDFLinkService({ eventBus });
  const findController = new pdfViewerLib.PDFFindController({ eventBus, linkService });
  const viewer = new pdfViewerLib.PDFViewer({ container, viewer: inner, eventBus, linkService, findController, removePageBorders: false });
  linkService.setViewer(viewer);
  const slot: ViewerSlot = { container, viewer, eventBus, linkService, findController };

  eventBus.on('pagechanging', (e: { pageNumber: number }) => {
    if (slot === active) {
      ($('#pageInput') as HTMLInputElement).value = String(e.pageNumber);
      saveState();
    }
  });
  eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
    if (slot !== active) return;
    const select = $('#zoom') as HTMLSelectElement;
    if (e.presetValue && [...select.options].some((o) => o.value === e.presetValue)) select.value = e.presetValue;
    else {
      const custom = select.querySelector('option[value="custom"]') as HTMLOptionElement;
      custom.textContent = `${Math.round(e.scale * 100)}%`;
      select.value = 'custom';
    }
  });
  eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
    $('#searchResult').textContent = e.matchesCount.total ? `${e.matchesCount.current} of ${e.matchesCount.total}` : 'No matches';
  });
  eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { current: number; total: number } }) => {
    if (e.state === 1) $('#searchResult').textContent = 'No matches';
  });

  container.addEventListener('click', (ev) => {
    if (settings.reverseClick === 'ctrl-click' && (ev.ctrlKey || ev.metaKey)) reverseSync(slot, ev);
  });
  container.addEventListener('dblclick', (ev) => {
    if (settings.reverseClick === 'double-click') reverseSync(slot, ev);
  });
  return slot;
}

function applyLayout(slot: ViewerSlot) {
  const { ScrollMode, SpreadMode } = pdfViewerLib;
  slot.viewer.scrollMode = layout === 'single' ? ScrollMode.PAGE : ScrollMode.VERTICAL;
  slot.viewer.spreadMode = layout === 'spread' ? SpreadMode.ODD : SpreadMode.NONE;
}

async function load(data: Uint8Array) {
  await ensureLib();
  const previous = active;
  // Remember where the reader is so the new PDF opens at the same place.
  const anchor = previous?.doc ? readAnchor(previous) : vscode.getState()?.anchor;

  let doc: PDFDocumentProxy;
  try {
    doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, enableXfa: false }).promise;
  } catch (err) {
    showState('invalid', 'Invalid or unreadable PDF', `The file could not be read (${String(err)}). Waiting for the next build…`);
    return;
  }

  const slot = createSlot();
  slot.container.style.visibility = previous ? 'hidden' : 'visible';
  applyLayout(slot);
  slot.doc = doc;
  slot.viewer.setDocument(doc);
  slot.linkService.setDocument(doc);

  await new Promise<void>((resolve) => slot.eventBus.on('pagesinit', () => resolve(), { once: true }));
  slot.viewer.currentScaleValue = scaleValue;
  if (anchor) restoreAnchor(slot, anchor);
  ($('#pageCount') as HTMLElement).textContent = `/ ${doc.numPages}`;
  ($('#pageInput') as HTMLInputElement).value = String(slot.viewer.currentPageNumber);
  hideState();

  const swap = () => {
    if (slot.container.style.visibility === 'visible' && active === slot) return;
    slot.container.style.visibility = 'visible';
    active = slot;
    if (previous && previous !== slot) {
      previous.viewer.setDocument(null as unknown as PDFDocumentProxy);
      void previous.doc?.destroy();
      previous.container.remove();
    }
    void renderOutline(doc);
    saveState();
    if (pendingSync) {
      forwardSync(pendingSync.page, pendingSync.box);
      pendingSync = undefined;
    }
  };
  if (!previous) swap();
  else {
    // Swap once the visible page has been drawn, or after a short timeout.
    const current = slot.viewer.currentPageNumber;
    slot.eventBus.on('pagerendered', (e: { pageNumber: number }) => {
      if (e.pageNumber === current) swap();
    });
    setTimeout(swap, 1500);
  }
  active = active ?? slot;
}

function readAnchor(slot: ViewerSlot) {
  const page = slot.viewer.currentPageNumber;
  const view = slot.viewer.getPageView(page - 1);
  const top = view?.div ? (slot.container.scrollTop - view.div.offsetTop) / Math.max(1, view.div.clientHeight) : 0;
  return { page, top, left: slot.container.scrollLeft };
}

function restoreAnchor(slot: ViewerSlot, anchor: { page: number; top: number; left: number }) {
  const page = Math.min(anchor.page, slot.viewer.pagesCount);
  const view = slot.viewer.getPageView(page - 1);
  if (!view?.div) return;
  slot.container.scrollTop = view.div.offsetTop + anchor.top * view.div.clientHeight;
  slot.container.scrollLeft = anchor.left;
}

function saveState() {
  const state = vscode.getState() ?? {};
  vscode.setState({ ...state, scale: scaleValue, layout, anchor: active?.doc ? readAnchor(active) : state.anchor });
}

function reverseSync(slot: ViewerSlot, ev: MouseEvent) {
  const pageEl = (ev.target as HTMLElement).closest('.page') as HTMLElement | null;
  if (!pageEl) return;
  const pageNumber = Number(pageEl.dataset.pageNumber);
  const view = slot.viewer.getPageView(pageNumber - 1);
  const rect = pageEl.getBoundingClientRect();
  const [x, y] = view.viewport.convertToPdfPoint(ev.clientX - rect.left, ev.clientY - rect.top);
  const viewBox = view.viewport.viewBox as number[];
  // SyncTeX measures from the top-left corner of the page.
  vscode.postMessage({ type: 'reverseSync', page: pageNumber, x: x - viewBox[0], y: viewBox[3] - y });
  ev.preventDefault();
}

function forwardSync(page: number, box: { left: number; top: number; width: number; height: number }) {
  const slot = active;
  if (!slot?.doc || slot.container.style.visibility === 'hidden') {
    pendingSync = { page, box };
    return;
  }
  const view = slot.viewer.getPageView(page - 1);
  if (!view) return;
  const viewBox = view.viewport.viewBox as number[];
  const pageWidth = viewBox[2] - viewBox[0];
  const pageHeight = viewBox[3] - viewBox[1];
  slot.viewer.scrollPageIntoView({ pageNumber: page, destArray: [null, { name: 'XYZ' }, null, pageHeight - box.top + 60, null], allowNegativeOffset: true });
  // The highlight is positioned in percentages so it stays correct when zooming.
  const mark = document.createElement('div');
  mark.className = 'syncMark';
  mark.style.left = `${(box.left / pageWidth) * 100}%`;
  mark.style.top = `${(box.top / pageHeight) * 100}%`;
  mark.style.width = `${(box.width / pageWidth) * 100}%`;
  mark.style.height = `${(box.height / pageHeight) * 100}%`;
  view.div.appendChild(mark);
  setTimeout(() => mark.classList.add('fade'), 1200);
  setTimeout(() => mark.remove(), 2200);
}

async function renderOutline(doc: PDFDocumentProxy) {
  const nav = $('#outline');
  nav.innerHTML = '';
  const outline = await doc.getOutline();
  if (!outline?.length) {
    nav.innerHTML = '<div class="empty">This PDF has no outline.</div>';
    return;
  }
  const build = (items: typeof outline, parent: HTMLElement, depth: number) => {
    for (const item of items) {
      const a = document.createElement('a');
      a.textContent = item.title;
      a.style.paddingLeft = `${8 + depth * 12}px`;
      a.href = '#';
      a.onclick = (e) => {
        e.preventDefault();
        if (item.dest) void active?.linkService.goToDestination(item.dest);
      };
      parent.appendChild(a);
      if (item.items?.length) build(item.items, parent, depth + 1);
    }
  };
  build(outline, nav, 0);
}

function showState(kind: string, title: string, detail: string, actions: { label: string; action: string; primary?: boolean }[] = []) {
  const el = $('#state');
  el.hidden = false;
  el.className = `card state-${kind}`;
  el.innerHTML = `<header class="caps">${title}</header><div class="state-body"><div>${detail}</div><div class="actions"></div></div>`;
  const box = el.querySelector('.actions') as HTMLElement;
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.className = 'primary';
    b.onclick = () => vscode.postMessage({ type: a.action });
    box.appendChild(b);
  }
}

function hideState() {
  $('#state').hidden = true;
}

function showBanner(html: string | undefined, kind = '') {
  const el = $('#banner');
  el.hidden = !html;
  el.className = kind;
  el.innerHTML = html ?? '';
  el.querySelectorAll('[data-action]').forEach((b) => ((b as HTMLElement).onclick = () => vscode.postMessage({ type: (b as HTMLElement).dataset.action })));
}

interface BuildStateMsg {
  phase: string;
  step?: string;
  errors: number;
  warnings: number;
  badBoxes: number;
  lastGoodAt?: number;
  finishedAt?: number;
  message?: string;
}

/** Fast and partial output is always labelled; a full build has no banner. */
function showMode(mode: string | undefined, label: string | undefined) {
  const el = $('#modeBanner');
  el.hidden = !mode || mode === 'full';
  el.className = mode ?? '';
  el.innerHTML = el.hidden ? '' : `<b>${(label ?? mode ?? '').split(' · ')[0].toUpperCase()}</b> <span>${(label ?? '').split(' · ').slice(1).join(' · ')}</span><button data-action="buildFull">Full build</button>`;
  el.querySelector('button')?.addEventListener('click', () => vscode.postMessage({ type: 'buildFull' }));
}

function updateBuild(state: BuildStateMsg, autoBuild: boolean, fastPreview: boolean) {
  ($('#autoBuild') as HTMLInputElement).checked = autoBuild;
  ($('#fastPreview') as HTMLInputElement).checked = fastPreview;
  $('#progress').classList.toggle('running', state.phase === 'building');
  const issues = $('#issues');
  issues.innerHTML = state.errors || state.warnings ? `<span class="err">${state.errors} ⊗</span> <span class="warn">${state.warnings} ⚠</span>` : '';
  const time = (t?: number) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  if (state.phase === 'building') {
    showBanner(`<b>Building</b> · ${state.step ?? 'starting'}<span class="muted"> · a newer save cancels this build and restarts it</span>`, 'info');
  } else if (state.phase === 'failed' && state.lastGoodAt && active?.doc) {
    showBanner(
      `<span class="err">⊗ Build failed ${time(state.finishedAt)}</span> <span class="muted">${state.message ?? ''} showing PDF from ${time(state.lastGoodAt)}</span><button data-action="openLog">Open log</button>`,
      'failed',
    );
  } else if (state.phase === 'failed' && !active?.doc) {
    showState('failed', 'Build failed', state.message ?? 'See the log for details.', [
      { label: 'Open log', action: 'openLog', primary: true },
      { label: 'Recompile', action: 'build' },
    ]);
    showBanner(undefined);
  } else {
    showBanner(undefined);
  }
}

// ---- toolbar wiring ----
const go = (n: number) => active && (active.viewer.currentPageNumber = Math.max(1, Math.min(active.viewer.pagesCount, n)));
$('#prev').onclick = () => active && go(active.viewer.currentPageNumber - 1);
$('#next').onclick = () => active && go(active.viewer.currentPageNumber + 1);
($('#pageInput') as HTMLInputElement).onchange = (e) => go(parseInt((e.target as HTMLInputElement).value, 10) || 1);
const setScale = (value: string) => {
  scaleValue = value;
  if (active) active.viewer.currentScaleValue = value;
  saveState();
};
($('#zoom') as HTMLSelectElement).onchange = (e) => setScale((e.target as HTMLSelectElement).value);
$('#zoomIn').onclick = () => active && setScale(String(Math.min(5, active.viewer.currentScale * 1.15).toFixed(3)));
$('#zoomOut').onclick = () => active && setScale(String(Math.max(0.25, active.viewer.currentScale / 1.15).toFixed(3)));
($('#layout') as HTMLSelectElement).value = layout;
($('#layout') as HTMLSelectElement).onchange = (e) => {
  layout = (e.target as HTMLSelectElement).value as typeof layout;
  if (active) applyLayout(active);
  saveState();
};
$('#outlineBtn').onclick = () => ($('#outline').hidden = !$('#outline').hidden);
$('#themeBtn').onclick = () => document.body.classList.toggle('dark-pages');
$('#recompile').onclick = () => vscode.postMessage({ type: 'build' });
$('#menuBtn').onclick = (e) => {
  e.stopPropagation();
  $('#menu').hidden = !$('#menu').hidden;
};
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#menu')) $('#menu').hidden = true;
});
document.querySelectorAll('#menu .menu-item').forEach((b) => {
  (b as HTMLElement).onclick = () => {
    vscode.postMessage({ type: (b as HTMLElement).dataset.action });
    $('#menu').hidden = true;
  };
});
($('#autoBuild') as HTMLInputElement).onchange = () => vscode.postMessage({ type: 'toggleAutoBuild' });
($('#fastPreview') as HTMLInputElement).onchange = () => vscode.postMessage({ type: 'toggleFastPreview' });
$('#issues').onclick = () => vscode.postMessage({ type: 'showProblems' });

function find(again: boolean, previous = false) {
  const query = ($('#searchInput') as HTMLInputElement).value;
  active?.eventBus.dispatch('find', { source: null, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
}
const openSearch = () => {
  $('#searchBar').hidden = false;
  ($('#searchInput') as HTMLInputElement).select();
};
$('#searchBtn').onclick = openSearch;
($('#searchInput') as HTMLInputElement).oninput = () => find(false);
($('#searchInput') as HTMLInputElement).onkeydown = (e) => {
  if (e.key === 'Enter') find(true, e.shiftKey);
  if (e.key === 'Escape') $('#searchClose').click();
};
$('#searchNext').onclick = () => find(true);
$('#searchPrev').onclick = () => find(true, true);
$('#searchClose').onclick = () => {
  $('#searchBar').hidden = true;
  active?.eventBus.dispatch('find', { source: null, type: '', query: '', highlightAll: false });
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    openSearch();
  }
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'load':
      showMode(msg.mode, msg.label);
      void load(msg.data);
      break;
    case 'remember':
      vscode.setState({ ...(vscode.getState() ?? {}), pdf: msg.pdf });
      break;
    case 'settings':
      settings = msg.settings;
      document.body.classList.toggle('dark-pages', settings.theme === 'dark' || (settings.theme === 'follow-editor' && document.body.classList.contains('vscode-dark')));
      break;
    case 'build':
      updateBuild(msg.state, msg.autoBuild, msg.fastPreview);
      break;
    case 'sync':
      hideBannerIf('sync');
      forwardSync(msg.page, msg.box);
      break;
    case 'syncUnavailable':
      showBanner(`<b>SyncTeX unavailable</b> <span class="muted">${msg.message}</span> <button data-action="build">Rebuild to sync</button>`, 'sync');
      break;
    case 'noPdf':
      showState('empty', 'No PDF yet', `<b>${msg.name}</b> hasn't been built<div class="muted">Root: ${msg.root} · recipe ${msg.recipe}</div>`, [
        { label: '▶ Build now', action: 'build', primary: true },
        { label: 'Choose root…', action: 'chooseRoot' },
      ]);
      break;
  }
});

function hideBannerIf(kind: string) {
  if ($('#banner').className === kind) showBanner(undefined);
}

window.addEventListener('resize', () => {
  if (active && ['page-width', 'page-fit', 'auto'].includes(scaleValue)) active.viewer.currentScaleValue = scaleValue;
});

vscode.postMessage({ type: 'ready' });
