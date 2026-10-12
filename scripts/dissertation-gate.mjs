// Final validation gate: build the author's thesis (Dissertation/) to main.pdf with the
// extension's own build code, in a temporary copy, and write a report outside the fixture.
//
//   npm run gate:dissertation            (fixture path: $LATEXSTUDIO_DISSERTATION or ./Dissertation)
//
// The thesis is never modified: sources are hashed before and after, and every build runs in a temp copy.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const core = require('../dist/gatecore.js');

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixture = path.resolve(process.env.LATEXSTUDIO_DISSERTATION ?? path.join(repo, 'Dissertation'));
const reportDir = path.join(repo, 'reports');
const report = { startedAt: new Date().toISOString(), fixture: '<fixture>', platform: `${process.platform} ${process.arch}`, node: process.version, verdict: 'FAIL', reasons: [] };
const log = (...a) => console.log('[gate]', ...a);

function finish() {
  fs.mkdirSync(reportDir, { recursive: true });
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(reportDir, 'dissertation-gate-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reportDir, 'dissertation-gate-report.md'), markdown(report));
  log(`verdict: ${report.verdict}${report.reasons.length ? ' — ' + report.reasons.join('; ') : ''}`);
  log(`report: ${path.join(reportDir, 'dissertation-gate-report.md')}`);
  process.exit(report.verdict.startsWith('PASS') ? 0 : report.verdict === 'SKIPPED' ? 0 : 1);
}

const run = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (err) {
    return err.stdout?.toString() ?? '';
  }
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const host = {
  readFile: async (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined),
  exists: async (f) => fs.existsSync(f),
};
const SOURCE = /\.(tex|bib|cls|sty|bst)$/i;
function listFiles(dir, filter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}
function hashSources(dir) {
  const map = {};
  for (const f of listFiles(dir, (f) => SOURCE.test(f))) map[path.relative(dir, f)] = sha256(f);
  return map;
}
const GENERATED = /^main\.(aux|bbl|blg|idx|ind|ilg|toc|lof|lot|loa|out|log|pdf|fls|fdb_latexmk|nlo|nls|synctex\.gz)$|\.aux$/;
function tempCopy(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ls-gate-${label}-`));
  fs.cpSync(fixture, dir, { recursive: true });
  // Start from a clean state: remove every generated file in the copy (never in the fixture).
  for (const f of listFiles(dir, (f) => GENERATED.test(path.basename(f)))) fs.unlinkSync(f);
  return dir;
}

async function build(dir, outDir, recipeName) {
  const recipe = core.BUILTIN_RECIPES.find((r) => r.name === recipeName);
  const root = path.join(dir, 'main.tex');
  const runner = new core.BuildRun({
    recipe,
    tools: core.BUILTIN_TOOLS,
    placeholders: { DOC: 'main', DOCFILE: 'main', DOC_EXT: 'main.tex', DIR: dir, OUTDIR: outDir, PATHSEP: path.delimiter },
    timeoutMs: 20 * 60 * 1000,
  });
  let output = '';
  runner.on('output', (t) => (output += t));
  const result = await runner.run();
  const logText = fs.existsSync(path.join(outDir, 'main.log')) ? fs.readFileSync(path.join(outDir, 'main.log'), 'utf8') : '';
  const summary = core.parseLatexLog(logText);
  const passes = (output.match(/^Latexmk: applying rule '(pdflatex|bibtex|makeindex)[^']*'/gm) ?? []).map((l) => l.replace(/^Latexmk: applying rule '/, '').replace(/'$/, ''));
  return { result, summary, logText, output, passes, root };
}

// ---------------------------------------------------------------- steps
// The gate runs as a list of steps. With LATEXSTUDIO_GATE_BUDGET_S set (for shells that limit how
// long a command may run), it stops after the step that exceeds the budget, saves its state in
// reports/.gate-state.json and exits with code 75; running it again continues where it stopped.
const statePath = path.join(reportDir, '.gate-state.json');
const budgetMs = Number(process.env.LATEXSTUDIO_GATE_BUDGET_S ?? 0) * 1000;
const started = Date.now();

if (!fs.existsSync(path.join(fixture, 'main.tex'))) {
  report.verdict = 'SKIPPED';
  report.reasons.push(`fixture not found (set LATEXSTUDIO_DISSERTATION or place it at ./Dissertation)`);
  finish();
}

const steps = [preflight, fullBuild, pdfFacts, synctexCheck, bibliography, outputDirectory, exportCheck, rebuilds, spelling, cleanAndVerdict];
let ctx = {};
if (budgetMs && fs.existsSync(statePath)) {
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  Object.assign(report, saved.report);
  ctx = saved.ctx;
  log(`resuming at step ${ctx.next + 1} of ${steps.length}`);
}
ctx.next ??= 0;
while (ctx.next < steps.length) {
  await steps[ctx.next]();
  ctx.next++;
  if (budgetMs && ctx.next < steps.length && Date.now() - started > budgetMs) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ report, ctx }));
    log(`time budget used; run the gate again to continue (step ${ctx.next + 1} of ${steps.length})`);
    process.exit(75);
  }
}

/** Values that are cheap to recompute from the files are not kept in the saved state. */
async function copyProject() {
  return core.loadProject(path.join(ctx.dir, 'main.tex'), host);
}
function citedKeysOf(project) {
  return new Set(project.files.flatMap((f) => f.index.citations.map((c) => c.key)));
}
function finalLog() {
  const file = path.join(ctx.dir, 'main.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

async function preflight() {
  log('pre-flight');
  ctx.before = hashSources(fixture);
  const texFiles = listFiles(fixture, (f) => f.endsWith('.tex'));
  const candidates = [];
  for (const f of texFiles) candidates.push({ path: f, index: core.parseTex(fs.readFileSync(f, 'utf8')) });
  const roots = candidates.filter((c) => c.index.documentClass && c.index.hasBeginDocument).map((c) => path.relative(fixture, c.path));
  const project = await core.loadProject(path.join(fixture, 'main.tex'), host);
  const tools = await core.detectTools();
  const version = (name) => {
    const t = tools.find((x) => x.name === name);
    return t?.path ? t.version ?? t.path : 'missing';
  };

  // Packages requested by the .tex sources (local .sty files count as available). The class loads
  // packages conditionally, which cannot be evaluated statically; those show up in the build log instead.
  const requested = new Set();
  for (const f of project.files) for (const p of f.index.packages) requested.add(p.name);
  const local = new Set(listFiles(fixture, (f) => f.endsWith('.sty')).map((f) => path.basename(f, '.sty')));
  const missing = (await core.missingPackages([...requested].filter((p) => !local.has(p)))).sort();

  const activeGraphics = project.graphics.length;
  const unresolvedGraphics = project.graphics.filter((g) => !g.resolved);
  report.preflight = {
    rootCandidates: roots,
    detectedRoot: roots.length === 1 ? roots[0] : roots.includes('main.tex') ? 'main.tex' : null,
    files: project.files.map((f) => path.relative(fixture, f.path)),
    unresolvedIncludes: project.unresolved.filter((u) => u.kind === 'include').map((u) => u.target),
    classFiles: project.styleFiles.map((f) => path.basename(f)),
    bibFiles: project.bibFiles.map((f) => path.basename(f)),
    tools: Object.fromEntries(['latexmk', 'pdflatex', 'bibtex', 'makeindex', 'synctex', 'kpsewhich'].map((t) => [t, version(t)])),
    packagesRequested: requested.size,
    packagesMissing: missing,
    graphics: {
      activeReferences: activeGraphics,
      uniqueNames: new Set(project.graphics.map((g) => g.target)).size,
      unresolved: unresolvedGraphics.map((g) => `${path.basename(g.file)}:${g.line + 1} ${g.target}`),
      resolvedExtensions: project.graphics.filter((g) => g.resolved).reduce((acc, g) => ((acc[path.extname(g.resolved)] = (acc[path.extname(g.resolved)] ?? 0) + 1), acc), {}),
    },
    sourceHashesBefore: Object.keys(ctx.before).length,
  };
  log(`root: ${report.preflight.detectedRoot}; ${project.files.length} files; ${activeGraphics} graphics (${unresolvedGraphics.length} unresolved); missing packages: ${missing.join(', ') || 'none'}`);
  if (report.preflight.detectedRoot !== 'main.tex') report.reasons.push(`root detection chose ${report.preflight.detectedRoot} (candidates: ${roots.join(', ')})`);
  if (missing.length) {
    report.verdict = 'FAIL';
    report.reasons.push(`environment: missing packages ${missing.join(', ')} — install the TeX Live / MiKTeX packages that provide them (for example with tlmgr or the MiKTeX Console), then rerun`);
    report.attribution = 'environment (TeX installation), not the tool';
    finish();
  }

  ctx.recipeName = core.chooseRecipe(core.BUILTIN_RECIPES, { magic: project.files[0].index.magic, configured: 'latexmk (pdf)', latexmkAvailable: version('latexmk') !== 'missing' }).recipe.name;
  ctx.activeGraphics = activeGraphics;
  ctx.unresolvedGraphics = unresolvedGraphics.length;
}

async function fullBuild() {
  log('full build in a temporary copy');
  const dir = (ctx.dir = tempCopy('full'));
  const project = await core.loadProject(path.join(fixture, 'main.tex'), host);
  const recipe = core.chooseRecipe(core.BUILTIN_RECIPES, { magic: project.files[0].index.magic, configured: 'latexmk (pdf)', latexmkAvailable: !!(await core.detectTools()).find((t) => t.name === 'latexmk')?.path });
  const t0 = Date.now();
  const first = await build(dir, dir, recipe.recipe.name);
  const firstMs = Date.now() - t0;
  const t1 = Date.now();
  const second = await build(dir, dir, recipe.recipe.name);
  const secondMs = Date.now() - t1;
  const finalLog = second.logText || first.logText;
  const finalSummary = core.parseLatexLog(finalLog);
  const errors = finalSummary.entries.filter((e) => e.severity === 'error');
  const undefinedMessages = finalLog.match(/(Citation .* undefined|Reference .* undefined|There were undefined references|Label\(s\) may have changed)/g) ?? [];

  report.build = {
    recipe: recipe.recipe.name,
    recipeReason: recipe.reason,
    steps: first.result.steps.map((s) => ({ command: [s.command, ...s.args].join(' '), exitCode: s.exitCode, ms: s.durationMs, skipped: s.skipped })),
    latexmkRules: first.passes,
    firstBuildMs: firstMs,
    secondBuildMs: secondMs,
    secondBuildRules: second.passes,
    exitOk: first.result.ok,
    errors: errors.map((e) => `${e.file ?? '?'}:${e.line ?? '?'} ${e.message}`),
    warnings: finalSummary.entries.filter((e) => e.severity === 'warning').length,
    badBoxes: finalSummary.entries.filter((e) => e.severity === 'badbox').length,
    undefinedOrRerunMessages: undefinedMessages,
    generated: ['main.pdf', 'main.synctex.gz', 'main.bbl', 'main.ind'].map((f) => `${f}: ${fs.existsSync(path.join(dir, f)) ? 'yes' : 'NO'}`),
  };
  log(`first build ${firstMs} ms (rules: ${first.passes.join(', ')}); second build ${secondMs} ms (rules: ${second.passes.join(', ') || 'none'})`);

  ctx.firstMs = firstMs;
  ctx.errors = errors.length;
  ctx.undefinedMessages = undefinedMessages.length;
  if (!fs.existsSync(path.join(dir, 'main.pdf'))) {
    report.reasons.push('no main.pdf was produced');
    finish();
  }
}


async function pdfFacts() {
  const dir = ctx.dir;
  const pdf = path.join(dir, 'main.pdf');
  const project = await core.loadProject(path.join(fixture, 'main.tex'), host);
  const info = run('pdfinfo', [pdf]);
  const fonts = run('pdffonts', [pdf]);
  const text = run('pdftotext', [pdf, '-']);
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  const fontLines = fonts.split('\n').slice(2).filter(Boolean);
  const notEmbedded = fontLines.filter((l) => / no\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.test(l));
  const citedKeys = citedKeysOf(project);
  const bbl = fs.existsSync(path.join(dir, 'main.bbl')) ? fs.readFileSync(path.join(dir, 'main.bbl'), 'utf8') : '';
  const bibitems = (bbl.match(/\\bibitem/g) ?? []).length;
  report.pdf = {
    sizeBytes: fs.statSync(pdf).size,
    sha256: sha256(pdf),
    pages,
    legacyPages: 254,
    pageSize: /Page size:\s+(.*)/.exec(info)?.[1],
    fonts: fontLines.length,
    fontsNotEmbedded: notEmbedded.length,
    outlineEntries: (run('pdftk', [pdf, 'dump_data']).match(/BookmarkTitle/g) ?? []).length || 'not measured (pdftk missing)',
    hasContents: /table of contents|^\s*contents\s*$/im.test(text.slice(0, 60000)),
    hasListOfFigures: /List of Figures/i.test(text),
    hasListOfTables: /List of Tables/i.test(text),
    index: indexFacts(dir, project, text),
    placeholdersQQ: (text.match(/\?\?/g) ?? []).length,
    bibliographyItems: bibitems,
    distinctCitedKeys: [...citedKeys].filter((k) => k !== '*').length,
  };
  log(`PDF: ${pages} pages, ${report.pdf.fonts} fonts (${notEmbedded.length} not embedded), ${bibitems} bibliography items for ${report.pdf.distinctCitedKeys} cited keys`);

  ctx.pages = pages;
}

async function synctexCheck() {
  const dir = ctx.dir;
  const pdf = path.join(dir, 'main.pdf');
  const pages = ctx.pages;
  const syncData = core.SyncTexData.parse(gunzipSync(fs.readFileSync(path.join(dir, 'main.synctex.gz'))).toString('utf8'));
  const copied = await copyProject();
  const forward = [];
  const chapterFiles = copied.files.filter((f) => /chapter-|appendix-/.test(path.basename(f.path)));
  for (const f of chapterFiles.slice(0, 6)) {
    const lines = fs.readFileSync(f.path, 'utf8').split(/\r?\n/);
    // Two prose lines per file: one early, one late; includes very long lines when they are prose.
    const prose = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^[A-Z][a-z]/.test(l.trim()) && l.length > 40);
    for (const pick of [prose[Math.floor(prose.length * 0.2)], prose[Math.floor(prose.length * 0.8)]].filter(Boolean)) {
      const line = pick.i + 1;
      const t = performance.now();
      const ours = syncData.forward(f.path, line);
      const ms = performance.now() - t;
      const cli = run('synctex', ['view', '-i', `${line}:0:${f.path}`, '-o', pdf]);
      const cliPages = [...cli.matchAll(/^Page:(\d+)/gm)].map((m) => +m[1]);
      const cliV = [...cli.matchAll(/^v:([\d.]+)/gm)].map((m) => +m[1]);
      const agree = !!ours && cliPages.includes(ours.page) && cliV.some((v) => Math.abs(v - ours.y) < 3);
      forward.push({ file: path.basename(f.path), line, longLine: pick.l.length > 600, crlf: fs.readFileSync(f.path, 'latin1').includes('\r\n'), ours: ours ? `p${ours.page} y${ours.y.toFixed(1)}` : 'none', cli: cliPages.length ? `p${cliPages[0]} v${cliV[0]}` : 'none', agree, ms: +ms.toFixed(2) });
    }
  }
  const reverse = [];
  for (let k = 0; k < 10; k++) {
    const page = Math.max(1, Math.round(((k + 1) * pages) / 11));
    const x = 200;
    const y = 300 + (k % 3) * 120;
    const t = performance.now();
    const ours = syncData.reverse(page, x, y);
    const ms = performance.now() - t;
    const cli = run('synctex', ['edit', '-o', `${page}:${x}:${y}:${pdf}`]);
    const cliFile = /^Input:(.*)$/m.exec(cli)?.[1];
    const cliLine = Number(/^Line:(\d+)/m.exec(cli)?.[1]);
    const agree = !!ours && !!cliFile && path.basename(ours.file) === path.basename(cliFile) && Math.abs(ours.line - cliLine) <= 2;
    reverse.push({ page, x, y, ours: ours ? `${path.basename(ours.file)}:${ours.line}` : 'none', cli: cliFile ? `${path.basename(cliFile)}:${cliLine}` : 'none', agree, ms: +ms.toFixed(2) });
  }
  report.synctex = {
    tolerance: 'forward: same page and within 3 bp of a box the tool reports; reverse: same file and within 2 lines',
    forward,
    reverse,
    forwardAgreement: `${forward.filter((f) => f.agree).length}/${forward.length}`,
    reverseAgreement: `${reverse.filter((r) => r.agree).length}/${reverse.length}`,
  };
  log(`SyncTeX agreement: forward ${report.synctex.forwardAgreement}, reverse ${report.synctex.reverseAgreement}`);

  ctx.firstForwardLine = forward[0]?.line;
  ctx.firstChapter = chapterFiles[0] ? path.basename(chapterFiles[0].path) : 'main.tex';
  ctx.synctexAgree = forward.every((f) => f.agree) && reverse.every((r) => r.agree);
}

async function bibliography() {
  const dir = ctx.dir;
  const citedKeys = citedKeysOf(await core.loadProject(path.join(fixture, 'main.tex'), host));
  const finalSummary = core.parseLatexLog(finalLog());
  const bibPath = path.join(fixture, 'references.bib');
  const bibText = fs.readFileSync(bibPath, 'utf8');
  const bib = core.parseBib(bibText);
  const scans = {};
  for (const profile of ['standard', 'strict']) {
    const res = core.scanBib(bib, bibText, { dialect: 'bibtex', profile, citedKeys });
    const byCode = {};
    for (const f of res.findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
    const scores = [...res.entries.values()].map((r) => r.score);
    scans[profile] = { findings: res.findings.length, byCode, averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)), duplicateGroups: res.duplicateGroups.length };
  }
  const bibKeys = new Set(bib.entries.map((e) => e.key));
  const unresolvedByScanner = [...citedKeys].filter((k) => k !== '*' && !bibKeys.has(k)).sort();
  const blg = fs.existsSync(path.join(dir, 'main.blg')) ? core.parseBlg(fs.readFileSync(path.join(dir, 'main.blg'), 'utf8')) : [];
  // Compare against the final pass only: earlier passes always report every citation as undefined.
  const unresolvedByCompiler = core.missingCitationKeys([...finalSummary.entries, ...blg]).sort();
  report.bibliography = {
    entries: bib.entries.length,
    syntaxIssues: bib.issues.length,
    profiles: scans,
    unresolvedByScanner,
    unresolvedByCompiler,
    crossCheck: JSON.stringify(unresolvedByScanner) === JSON.stringify(unresolvedByCompiler) ? 'agree' : 'differ',
    uncited: [...bibKeys].filter((k) => !citedKeys.has(k)).length,
  };
  log(`bibliography: ${bib.entries.length} entries; unresolved scanner=${unresolvedByScanner.length} compiler=${unresolvedByCompiler.length}`);

}

async function outputDirectory() {
  log('build with a separate output directory (build/)');
  const dir2 = tempCopy('outdir');
  const outDir = path.join(dir2, 'build');
  core.prepareOutDir(outDir, dir2, (await core.loadProject(path.join(dir2, 'main.tex'), host)).files.map((f) => f.path));
  const third = await build(dir2, outDir, ctx.recipeName);
  const outPdf = path.join(outDir, 'main.pdf');
  let outSync = 'no synctex';
  if (fs.existsSync(path.join(outDir, 'main.synctex.gz'))) {
    const d = core.SyncTexData.parse(gunzipSync(fs.readFileSync(path.join(outDir, 'main.synctex.gz'))).toString('utf8'));
    const r = ctx.firstForwardLine && d.forward(path.join(dir2, ctx.firstChapter), ctx.firstForwardLine);
    outSync = r ? `forward ok (page ${r.page})` : 'forward failed';
  }
  report.outputDirectory = { pdf: fs.existsSync(outPdf), pages: Number(/Pages:\s+(\d+)/.exec(run('pdfinfo', [outPdf]))?.[1] ?? 0), synctex: outSync, ok: third.result.ok };

  fs.rmSync(dir2, { recursive: true, force: true });
}

async function exportCheck() {
  const dir = ctx.dir;
  log('export for submission (arXiv preset) and verify in a clean folder');
  const plan = core.planExport(await copyProject(), dir, 'main', core.PRESETS.arxiv, 'arxiv');
  const verified = await core.verifyExport(plan, 'main.tex', 'main');
  report.export = {
    files: plan.files.length,
    megabytes: +(plan.totalBytes / 1048576).toFixed(1),
    checks: plan.checks.map((c) => `${c.level}: ${c.message.replace(/^.*? — /, '<file> — ')}`),
    verify: verified.message,
    ok: verified.ok,
  };
  log(`export: ${plan.files.length} files, ${report.export.megabytes} MB; ${verified.message}`);

}

async function rebuilds() {
  const dir = ctx.dir;
  // A one-sentence edit in chapter-intro.tex (in the temporary copy), then three ways to rebuild.
  log('one-sentence edit: incremental, fast preview and partial rebuilds');
  const intro = path.join(dir, 'chapter-intro.tex');
  const introText = fs.readFileSync(intro, 'utf8');
  const eol = introText.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(intro, introText.replace(/(\\section\{[^}]*\}[^\n]*\n)/, `$1This sentence was added by the gate to time a rebuild.${eol}`));
  const preview = async (kind, preTex) => {
    const out = path.join(dir, '.latexstudio', kind);
    core.seedFromFullBuild(dir, out, 'main');
    const tool = core.previewTool('-pdf', preTex);
    const t = Date.now();
    const res = await new core.BuildRun({ recipe: { name: kind, tools: [tool.name] }, tools: [tool], placeholders: { DOC: 'main', DOCFILE: 'main', DOC_EXT: 'main.tex', DIR: dir, OUTDIR: out, PATHSEP: path.delimiter }, timeoutMs: 20 * 60 * 1000 }).run();
    const pagesOut = Number(/Pages:\s+(\d+)/.exec(run('pdfinfo', [path.join(out, 'main.pdf')]))?.[1] ?? 0);
    return { ms: Date.now() - t, ok: res.ok, pages: pagesOut };
  };
  const tInc = Date.now();
  const incremental = await build(dir, dir, ctx.recipeName);
  const incrementalMs = Date.now() - tInc;
  const fastFirst = await preview('fast', '\\PassOptionsToPackage{draft}{graphicx}');
  const partial = await preview('partial', '\\includeonly{chapter-intro}');
  // The first fast preview sets up its folder (latexmk has no history there yet, so it also runs
  // BibTeX and makeindex). Time a second edit too, which is what working with it feels like.
  fs.writeFileSync(intro, fs.readFileSync(intro, 'utf8').replace('added by the gate', 'added by the gate (second edit)'));
  const tInc2 = Date.now();
  const incremental2 = await build(dir, dir, ctx.recipeName);
  const incremental2Ms = Date.now() - tInc2;
  const fast = await preview('fast', '\\PassOptionsToPackage{draft}{graphicx}');
  report.rebuilds = {
    fullFromCleanMs: ctx.firstMs,
    incrementalMs,
    incrementalRules: incremental.passes,
    fastPreviewFirstRun: fastFirst,
    partialChapterIntro: partial,
    secondEdit: { incrementalMs: incremental2Ms, incrementalRules: incremental2.passes, fastPreview: fast },
    speedupFastVsIncremental: +(incremental2Ms / Math.max(1, fast.ms)).toFixed(2),
    speedupPartialVsIncremental: +(incrementalMs / Math.max(1, partial.ms)).toFixed(2),
    note: 'Fast preview and partial builds start from the full build\'s auxiliary files and run in .latexstudio/ of the temporary copy.',
  };
  log(`rebuilds: incremental ${incrementalMs} ms, first fast preview ${fastFirst.ms} ms, partial ${partial.ms} ms (${partial.pages} pp); second edit: incremental ${incremental2Ms} ms, fast preview ${fast.ms} ms (${fast.pages} pp)`);

}

async function spelling() {
  report.spelling = await spellCheckTiming(await copyProject(), repo);
  log(`spelling: ${report.spelling.files} files in ${report.spelling.totalMs} ms (dictionary load included); slowest file ${report.spelling.slowestFileMs} ms`);

}

async function cleanAndVerdict() {
  const dir = ctx.dir;
  const generated = core.listGenerated(dir, 'main', ['.aux', '.bbl', '.blg', '.idx', '.ind', '.ilg', '.toc', '.lof', '.lot', '.out', '.fls', '.fdb_latexmk', '.log', '.synctex.gz', '.loa']);
  const sourcesBeforeClean = hashSources(dir);
  const cleaned = core.cleanFiles(generated);
  const sourcesAfterClean = hashSources(dir);
  report.clean = {
    removed: cleaned.removed.map((f) => path.basename(f)),
    refused: cleaned.refused.map((f) => path.basename(f)),
    sourcesIntact: JSON.stringify(sourcesBeforeClean) === JSON.stringify(sourcesAfterClean),
    figuresIntact: fs.existsSync(path.join(dir, 'Figs')) ? fs.readdirSync(path.join(dir, 'Figs')).length : 0,
  };

  // ---------------------------------------------------------------- source hashes
  const after = hashSources(fixture);
  const changed = Object.keys(ctx.before).filter((k) => ctx.before[k] !== after[k]);
  report.sourceHashes = { files: Object.keys(ctx.before).length, changed };

  // ---------------------------------------------------------------- verdict
  const fail = (cond, reason) => cond && report.reasons.push(reason);
  fail(ctx.errors > 0, `${ctx.errors} TeX errors in the final log`);
  fail(ctx.undefinedMessages > 0, `undefined citations/references or rerun messages remain: ${ctx.undefinedMessages}`);
  fail(ctx.unresolvedGraphics > 0, `${ctx.unresolvedGraphics} active graphics do not resolve`);
  fail(report.pdf.fontsNotEmbedded > 0, `${report.pdf.fontsNotEmbedded} fonts not embedded`);
  fail(report.pdf.placeholdersQQ > 0, `PDF text contains ${report.pdf.placeholdersQQ} "??" placeholders`);
  fail(!report.pdf.index.ok, `index: ${report.pdf.index.detail}`);
  fail(report.bibliography.crossCheck !== 'agree', 'scanner and compiler disagree on unresolved citations');
  fail(!ctx.synctexAgree, 'SyncTeX disagrees with the synctex tool on some samples');
  fail(report.export && !report.export.ok, `the exported copy does not compile: ${report.export?.verify}`);
  fail(!report.outputDirectory.pdf, 'separate output directory build did not produce build/main.pdf');
  fail(!report.clean.sourcesIntact, 'clean touched source files');
  fail(changed.length > 0, `fixture sources changed: ${changed.join(', ')}`);
  report.verdict = report.reasons.length ? 'FAIL' : 'PASS';
  report.tempCopies = 'deleted';
  fs.rmSync(dir, { recursive: true, force: true });
  if (fs.existsSync(statePath)) fs.rmSync(statePath);
  finish();
}


/** Spell checks every body file of the project through the real worker; reports counts and timings only. */
async function spellCheckTiming(project, repoDir) {
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker(path.join(repoDir, 'dist', 'spellWorker.js'));
  const dict = { aff: path.join(repoDir, 'dist', 'dictionaries', 'en_US.aff'), dic: path.join(repoDir, 'dist', 'dictionaries', 'en_US.dic') };
  const root = project.files.find((f) => f.path === project.root);
  const begin = root.index.beginDocumentOffset ?? 0;
  const preamble = new Set(root.children.filter((c) => c.offset < begin).map((c) => c.path));
  const files = project.files.filter((f) => !preamble.has(f.path));
  const t0 = Date.now();
  let flagged = 0;
  let slowest = 0;
  let id = 0;
  for (const f of files) {
    const text = fs.readFileSync(f.path, 'utf8');
    const t = Date.now();
    const reply = await new Promise((resolve) => {
      worker.once('message', resolve);
      worker.postMessage({ id: ++id, type: 'check', ...dict, words: [], text, skipCommands: [], from: f.index.beginDocumentOffset ?? 0 });
    });
    if (id > 1) slowest = Math.max(slowest, Date.now() - t);
    flagged += reply.wrong?.length ?? 0;
  }
  await worker.terminate();
  return { files: files.length, skippedPreambleFiles: preamble.size, flaggedWords: flagged, totalMs: Date.now() - t0, slowestFileMs: slowest, budget: 'PERF-16: < 1000 ms for the initial pass' };
}

/** The index must be generated; when the sources contain no \\index entries an empty index is expected. */
function indexFacts(dir, project, text) {
  const entries = project.files.reduce((n, f) => n + (fs.readFileSync(f.path, 'utf8').match(/\\index\{/g) ?? []).length, 0);
  const ind = path.join(dir, 'main.ind');
  const indText = fs.existsSync(ind) ? fs.readFileSync(ind, 'utf8') : undefined;
  if (indText === undefined) return { ok: false, entries, detail: 'main.ind was not generated' };
  if (entries === 0) return { ok: true, entries, detail: 'no \\index entries in the sources; makeindex produced an empty index' };
  const ok = /\bIndex\b/.test(text.slice(-200000));
  return { ok, entries, detail: ok ? 'index printed' : 'index entries exist but no index heading was found in the PDF' };
}

function markdown(r) {
  const lines = [`# Dissertation gate: ${r.verdict}`, '', `Run ${r.startedAt} on ${r.platform}, Node ${r.node}.`, ''];
  if (r.reasons.length) lines.push('## Reasons', '', ...r.reasons.map((x) => `- ${x}`), '');
  if (r.preflight) {
    const p = r.preflight;
    lines.push('## Pre-flight', '', `- Root: **${p.detectedRoot}** (candidates: ${p.rootCandidates.join(', ')})`, `- ${p.files.length} source files, unresolved includes: ${p.unresolvedIncludes.length}`, `- Class/style files: ${p.classFiles.join(', ')}; bibliography: ${p.bibFiles.join(', ')}`, `- Tools: ${Object.entries(p.tools).map(([k, v]) => `${k} ${v}`).join('; ')}`, `- Packages: ${p.packagesRequested} requested, missing: ${p.packagesMissing.join(', ') || 'none'}`, `- Graphics: ${p.graphics.activeReferences} active references (${p.graphics.uniqueNames} unique), unresolved: ${p.graphics.unresolved.length}, extensions picked: ${JSON.stringify(p.graphics.resolvedExtensions)}`, '');
  }
  if (r.build) {
    const b = r.build;
    lines.push('## Build', '', `- Recipe: ${b.recipe} (${b.recipeReason})`, `- First build: ${(b.firstBuildMs / 1000).toFixed(1)} s, latexmk rules: ${b.latexmkRules.join(' → ')}`, `- Second build (no changes): ${(b.secondBuildMs / 1000).toFixed(1)} s, rules run: ${b.secondBuildRules.join(', ') || 'none'}`, `- Errors: ${b.errors.length}; warnings: ${b.warnings}; bad boxes: ${b.badBoxes}`, `- Undefined/rerun messages in final log: ${b.undefinedOrRerunMessages.length}`, `- Generated: ${b.generated.join(', ')}`, '');
    if (b.errors.length) lines.push('Errors:', '', ...b.errors.map((e) => `- ${e}`), '');
  }
  if (r.pdf) {
    const p = r.pdf;
    lines.push('## PDF', '', `| Fact | Value |`, `|---|---|`, ...Object.entries(p).map(([k, v]) => `| ${k} | ${typeof v === 'object' ? v.detail ?? JSON.stringify(v) : v} |`), '', 'The page count differs from the legacy MiKTeX build when distributions and fonts differ; review before fixing a tolerance.', '');
  }
  if (r.synctex) {
    lines.push('## SyncTeX vs `synctex`', '', `Tolerance: ${r.synctex.tolerance}. Forward ${r.synctex.forwardAgreement}, reverse ${r.synctex.reverseAgreement}.`, '', '| File | Line | Ours | Tool | Agree | ms |', '|---|---|---|---|---|---|', ...r.synctex.forward.map((f) => `| ${f.file}${f.crlf ? ' (CRLF)' : ''}${f.longLine ? ' (long line)' : ''} | ${f.line} | ${f.ours} | ${f.cli} | ${f.agree ? 'yes' : 'NO'} | ${f.ms} |`), '', '| Page | x,y | Ours | Tool | Agree | ms |', '|---|---|---|---|---|---|', ...r.synctex.reverse.map((x) => `| ${x.page} | ${x.x},${x.y} | ${x.ours} | ${x.cli} | ${x.agree ? 'yes' : 'NO'} | ${x.ms} |`), '');
  }
  if (r.bibliography) {
    const b = r.bibliography;
    lines.push('## Bibliography scanner', '', `${b.entries} entries, ${b.syntaxIssues} syntax issues, ${b.uncited} uncited.`, '', ...Object.entries(b.profiles).map(([name, s]) => `- **${name}**: ${s.findings} findings, average score ${s.averageScore}, duplicate groups ${s.duplicateGroups}: ${Object.entries(s.byCode).map(([c, n]) => `${c} ${n}`).join(', ')}`), `- Unresolved citations: scanner ${b.unresolvedByScanner.length}, compiler ${b.unresolvedByCompiler.length} (${b.crossCheck})`, '');
  }
  if (r.outputDirectory) lines.push('## Separate output directory', '', `build/main.pdf: ${r.outputDirectory.pdf ? 'yes' : 'no'}, ${r.outputDirectory.pages} pages, SyncTeX: ${r.outputDirectory.synctex}`, '');
  if (r.export) lines.push('## Export for submission (arXiv preset)', '', `${r.export.files} files, ${r.export.megabytes} MB. Verify: ${r.export.verify}`, '', ...r.export.checks.map((c) => `- ${c}`), '');
  if (r.rebuilds) {
    const b = r.rebuilds;
    lines.push('## Rebuild after a one-sentence edit', '', '| Build | Time | Pages |', '|---|---|---|', `| Full, from clean | ${(b.fullFromCleanMs / 1000).toFixed(1)} s | |`, `| Incremental (latexmk, rules: ${b.incrementalRules.join(', ') || 'none'}) | ${(b.incrementalMs / 1000).toFixed(1)} s | |`, `| Fast preview, first run in its folder | ${(b.fastPreviewFirstRun.ms / 1000).toFixed(1)} s | ${b.fastPreviewFirstRun.pages} |`, `| Partial (chapter-intro only) | ${(b.partialChapterIntro.ms / 1000).toFixed(1)} s | ${b.partialChapterIntro.pages} |`, `| Second edit: incremental (rules: ${b.secondEdit.incrementalRules.join(', ') || 'none'}) | ${(b.secondEdit.incrementalMs / 1000).toFixed(1)} s | |`, `| Second edit: fast preview | ${(b.secondEdit.fastPreview.ms / 1000).toFixed(1)} s | ${b.secondEdit.fastPreview.pages} |`, '', `Speed-up against the incremental build: fast preview ${b.speedupFastVsIncremental}× (second edit), partial ${b.speedupPartialVsIncremental}×. The first fast preview is slower because latexmk also runs BibTeX and makeindex once in the new folder. ${b.note}`, '');
  }
  if (r.spelling) lines.push('## Spell checking', '', `${r.spelling.files} files (${r.spelling.skippedPreambleFiles} preamble files skipped), ${r.spelling.flaggedWords} words not in the en_US dictionary, ${r.spelling.totalMs} ms including dictionary load, slowest file ${r.spelling.slowestFileMs} ms (${r.spelling.budget}).`, '');
  if (r.clean) lines.push('## Clean', '', `Removed ${r.clean.removed.length} generated files; sources intact: ${r.clean.sourcesIntact}; figures present: ${r.clean.figuresIntact}`, '');
  if (r.sourceHashes) lines.push('## Fixture integrity', '', `${r.sourceHashes.files} source files hashed before and after; changed: ${r.sourceHashes.changed.length ? r.sourceHashes.changed.join(', ') : 'none'}`, '');
  return lines.join('\n');
}
