// Starts, supersedes and stops builds, and turns logs into Problems entries.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BuildRun, BuildResult, waitForStablePdf } from '../build/runner';
import { BUILTIN_RECIPES, BUILTIN_TOOLS, chooseRecipe, previewTool, Recipe, Tool } from '../build/recipes';
import { ensureStudioDir, prepareOutDir, seedFromFullBuild, snapshotExistingPdf } from '../build/outputs';
import { LogEntry, parseBlg, parseLatexLog } from '../core/logParser';
import { explain, Rule } from '../core/explain';
import { ProjectManager } from './projectManager';
import { config, debounce, isBib, isTex } from './util';
import { ToolRegistry } from './toolRegistry';

export type BuildPhase = 'idle' | 'building' | 'succeeded' | 'failed' | 'cancelled';

/** full: the normal build. fast: draft images, separate folder. partial: one \include'd chapter. */
export type BuildMode = 'full' | 'fast' | 'partial';

/** What the viewer shows for a root's PDF: the full build or the latest preview build. */
export interface PdfSource {
  file: string;
  mode: BuildMode;
  label?: string;
}

export interface BuildState {
  phase: BuildPhase;
  root?: string;
  recipe?: string;
  mode?: BuildMode;
  /** e.g. "pdflatex · pass 2" */
  step?: string;
  startedAt?: number;
  durationMs?: number;
  finishedAt?: number;
  errors: number;
  warnings: number;
  badBoxes: number;
  pdf?: string;
  /** Time of the last build that produced a usable PDF. */
  lastGoodAt?: number;
  message?: string;
}

export class BuildManager implements vscode.Disposable {
  state: BuildState = { phase: 'idle', errors: 0, warnings: 0, badBoxes: 0 };
  entries: LogEntry[] = [];
  private current?: BuildRun;
  private snapshotted = new Set<string>();
  private previews = new Map<string, PdfSource>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('latexstudio-build');
  private readonly stateChanged = new vscode.EventEmitter<BuildState>();
  readonly onDidChangeState = this.stateChanged.event;
  private readonly pdfReady = new vscode.EventEmitter<string>();
  /** Fires with the PDF path after a build produced a complete PDF. */
  readonly onDidProducePdf = this.pdfReady.event;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectManager,
    private readonly tools: ToolRegistry,
    private readonly output: vscode.OutputChannel,
  ) {
    const autoBuild = debounce(() => void this.build({ mode: this.fastPreview ? 'fast' : 'full' }), 300);
    // Saves made by files.autoSave "afterDelay" happen while typing; they should not start builds.
    const autoSaved = new Set<string>();
    this.disposables.push(
      this.diagnostics,
      this.stateChanged,
      this.pdfReady,
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (e.reason === vscode.TextDocumentSaveReason.AfterDelay) autoSaved.add(e.document.fileName);
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (autoSaved.delete(doc.fileName)) return;
        if (!(isTex(doc) || isBib(doc))) return;
        if (config(doc.uri).get('build.autoBuild') !== 'onSave') return;
        if (!vscode.workspace.isTrusted) return;
        // Only build when the saved file belongs to the current project (or is the root itself).
        if (this.projects.root && !this.projects.isInProject(doc.fileName)) return;
        autoBuild();
      }),
    );
  }

  dispose() {
    this.current?.cancel();
    this.disposables.forEach((d) => d.dispose());
  }

  get isBuilding() {
    return this.state.phase === 'building';
  }

  /** When on, "Build" and build-on-save produce a fast preview instead of a full build. */
  get fastPreview(): boolean {
    return this.context.workspaceState.get<boolean>('latexstudio.fastPreview') ?? false;
  }

  async setFastPreview(on: boolean) {
    await this.context.workspaceState.update('latexstudio.fastPreview', on);
    this.setState({ ...this.state });
  }

  /** The file the viewer should show for `pdf` (the full build's PDF path). */
  displayed(pdf: string): PdfSource {
    return this.previews.get(pdf) ?? { file: pdf, mode: 'full' };
  }

  recipes(): Recipe[] {
    const extra = config().get<Recipe[]>('build.recipes') ?? [];
    return [...extra, ...BUILTIN_RECIPES.filter((r) => !extra.some((e) => e.name === r.name))];
  }

  private toolList(): Tool[] {
    const extra = config().get<Tool[]>('build.tools') ?? [];
    return [...extra, ...BUILTIN_TOOLS.filter((t) => !extra.some((e) => e.name === t.name))];
  }

  async build(options: { recipe?: string; fromScratch?: boolean; mode?: BuildMode } = {}): Promise<BuildResult | undefined> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('LaTeX Studio: building is disabled in Restricted Mode. Trust this workspace to build.');
      return undefined;
    }
    await this.projects.refresh();
    const root = this.projects.root;
    const out = this.projects.output();
    if (!root || !out) {
      void vscode.window.showWarningMessage('LaTeX Studio: no root document found. Open a .tex file with \\documentclass, or run "Select Root Document".');
      return undefined;
    }

    // A newer build supersedes the running one; the last good PDF stays on screen.
    if (this.current) {
      this.current.cancel();
      this.output.appendLine('[build] superseded by a newer build');
    }

    // Save the project's open, modified files first.
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.isDirty && (isTex(doc) || isBib(doc)) && this.projects.isInProject(doc.fileName)) await doc.save();
    }

    const rootIndex = this.projects.index(root);
    const choice = chooseRecipe(this.recipes(), {
      explicit: options.recipe,
      magic: rootIndex?.magic ?? {},
      configured: this.context.workspaceState.get<string>('latexstudio.recipe') ?? config().get<string>('build.recipe') ?? 'latexmk (pdf)',
      latexmkAvailable: await this.tools.has('latexmk'),
    });
    if (choice.problem) void vscode.window.showWarningMessage(`LaTeX Studio: ${choice.problem}`);
    if (!choice.recipe) return undefined;

    const mode = options.mode ?? 'full';
    let recipe = choice.recipe;
    let tools = this.toolList();
    let outDir = out.outDir;
    let label: string | undefined;
    if (mode !== 'full') {
      const preview = await this.previewSetup(mode, root, choice.recipe);
      if (!preview) return undefined;
      ({ recipe, tools, outDir, label } = preview);
      seedFromFullBuild(out.outDir, outDir, out.jobName);
    }

    prepareOutDir(outDir, path.dirname(root), this.projects.project?.files.map((f) => f.path) ?? []);
    if (options.fromScratch) this.removeAuxiliary(outDir, out.jobName);

    if (mode === 'full' && config().get('build.backupExistingPdf') && !this.snapshotted.has(root)) {
      this.snapshotted.add(root);
      const snapshot = snapshotExistingPdf(out.outDir, out.jobName, path.dirname(root));
      if (snapshot) this.output.appendLine(`[build] saved a copy of the existing ${out.jobName}.pdf in ${snapshot}`);
    }

    const run = new BuildRun({
      recipe,
      tools,
      placeholders: {
        DOC: out.jobName,
        DOCFILE: out.jobName,
        DOC_EXT: path.basename(root),
        DIR: path.dirname(root),
        OUTDIR: outDir,
        PATHSEP: path.delimiter,
      },
      executablePaths: config().get<Record<string, string>>('tools.paths') ?? {},
      timeoutMs: (config().get<number>('build.timeout') ?? 600) * 1000,
    });
    this.current = run;
    let pass = 0;
    this.setState({
      phase: 'building',
      root,
      recipe: recipe.name,
      mode,
      startedAt: Date.now(),
      step: undefined,
      errors: this.state.errors,
      warnings: this.state.warnings,
      badBoxes: this.state.badBoxes,
      pdf: out.pdf,
      lastGoodAt: this.state.lastGoodAt,
      message: undefined,
    });
    void vscode.commands.executeCommand('setContext', 'latexstudio.building', true);

    this.output.appendLine(`\n[build] ${new Date().toLocaleTimeString()} ${path.basename(root)} with "${recipe.name}" (${mode === 'full' ? choice.reason : label})`);
    run.on('output', (text: string) => this.output.append(text));
    run.on('step', (step) => {
      if (/latex|latexmk|tectonic/.test(step.tool)) pass++;
      const label = step.skipped ? `${step.tool} skipped` : /latexmk/.test(step.tool) ? 'latexmk' : /latex/.test(step.tool) ? `${step.tool} · pass ${pass}` : step.tool;
      if (step.skipped) this.output.appendLine(`[build] skipped ${step.tool}: ${step.skipped}`);
      this.setState({ ...this.state, step: label });
    });
    // Publish diagnostics after every step so errors appear before the whole recipe ends.
    run.on('stepDone', () => {
      if (this.current === run) this.readLogs(root, outDir, out.jobName);
    });

    const result = await run.run();
    if (this.current !== run) return result; // superseded; the newer build owns the state
    this.current = undefined;
    void vscode.commands.executeCommand('setContext', 'latexstudio.building', false);

    this.readLogs(root, outDir, out.jobName);
    const pdfFile = path.join(outDir, out.jobName + '.pdf');
    const pdfOk = !result.cancelled && fs.existsSync(pdfFile) && (await waitForStablePdf(pdfFile));
    // latexmk skips all work when nothing changed, so an unchanged PDF after a successful run is fine.
    const producedNow = pdfOk && fs.statSync(pdfFile).mtimeMs >= (this.state.startedAt ?? 0) - 1000;

    let message: string | undefined;
    if (result.missingExecutable) message = `${result.missingExecutable} was not found. Install a TeX distribution or set latexstudio.tools.paths.`;
    else if (result.timedOut) message = 'The build took longer than latexstudio.build.timeout and was stopped.';
    else if (result.cancelled) message = 'Build stopped.';
    else if (!pdfOk) message = 'The build did not produce a PDF.';

    const failed = !result.ok || this.state.errors > 0 || !pdfOk;
    this.setState({
      ...this.state,
      phase: result.cancelled ? 'cancelled' : failed ? 'failed' : 'succeeded',
      durationMs: result.durationMs,
      finishedAt: Date.now(),
      step: undefined,
      lastGoodAt: pdfOk && !failed ? Date.now() : this.state.lastGoodAt,
      message,
    });
    this.output.appendLine(`[build] ${this.state.phase} in ${(result.durationMs / 1000).toFixed(1)} s · ${this.state.errors} errors, ${this.state.warnings} warnings`);

    if (result.missingExecutable) {
      const pick = await vscode.window.showErrorMessage(`LaTeX Studio: ${message}`, 'Check LaTeX Tools');
      if (pick) void vscode.commands.executeCommand('latexstudio.checkTools');
    }
    // Even a build with errors may produce a usable PDF (nonstopmode), so show it.
    if (producedNow) {
      if (mode === 'full') this.previews.delete(out.pdf);
      else this.previews.set(out.pdf, { file: pdfFile, mode, label });
      this.pdfReady.fire(out.pdf);
    }
    return result;
  }

  /**
   * Fast preview and partial builds run latexmk in `.latexstudio/fast` or `.latexstudio/partial`
   * with extra TeX code before the root file, so the full build's files are never touched.
   */
  private async previewSetup(mode: BuildMode, root: string, base: Recipe) {
    if (!(await this.tools.has('latexmk'))) {
      void vscode.window.showWarningMessage('LaTeX Studio: fast preview and partial builds need latexmk.');
      return undefined;
    }
    let preTex: string;
    let label: string;
    if (mode === 'fast') {
      preTex = '\\PassOptionsToPackage{draft}{graphicx}';
      label = 'Fast preview · draft images · not for submission';
    } else {
      const chapter = this.includedChapter(vscode.window.activeTextEditor?.document.fileName, root);
      if (!chapter) {
        void vscode.window.showWarningMessage('LaTeX Studio: open a chapter that the root document loads with \\include to build it alone.');
        return undefined;
      }
      preTex = `\\includeonly{${chapter}}`;
      label = `Partial · ${chapter} only`;
    }
    const engine = base.tools.some((t) => t.includes('xelatex')) ? '-xelatex' : base.tools.some((t) => t.includes('lualatex')) ? '-lualatex' : '-pdf';
    const outDir = path.join(ensureStudioDir(path.dirname(root)), mode);
    return {
      recipe: { name: mode === 'fast' ? 'latexmk (fast preview)' : 'latexmk (partial)', tools: ['latexmk-preview'] },
      tools: [previewTool(engine, preTex)],
      outDir,
      label,
    };
  }

  /** The \include name (e.g. "chapters/intro") of the chapter that contains `file`, if any. */
  includedChapter(file: string | undefined, root: string): string | undefined {
    const project = this.projects.project;
    if (!file || !project) return undefined;
    let chapter = path.normalize(file);
    while (project.parents.get(chapter) && project.parents.get(chapter) !== root) chapter = project.parents.get(chapter)!;
    if (project.parents.get(chapter) !== root) return undefined;
    const name = path.relative(path.dirname(root), chapter).replace(/\\/g, '/').replace(/\.tex$/, '');
    const rootIndex = this.projects.index(root);
    const included = rootIndex?.includes.some((i) => i.kind === 'include' && i.path.replace(/\.tex$/, '') === name);
    return included ? name : undefined;
  }

  stop() {
    if (this.current) {
      this.current.cancel();
      this.output.appendLine('[build] stop requested');
    }
  }

  private removeAuxiliary(outDir: string, jobName: string) {
    for (const ext of ['.aux', '.bbl', '.blg', '.fdb_latexmk', '.fls', '.idx', '.ind', '.ilg', '.toc', '.lof', '.lot', '.out', '.bcf', '.run.xml']) {
      const f = path.join(outDir, jobName + ext);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  private readLogs(root: string, outDir: string, jobName: string) {
    const entries: LogEntry[] = [];
    try {
      const log = fs.readFileSync(path.join(outDir, jobName + '.log'), 'utf8');
      entries.push(...parseLatexLog(log).entries);
    } catch {
      // No log yet (the first pass may not have started).
    }
    try {
      const blg = fs.readFileSync(path.join(outDir, jobName + '.blg'), 'utf8');
      entries.push(...parseBlg(blg));
    } catch {
      // No bibliography run.
    }
    this.entries = entries;
    this.publish(root, entries);
  }

  private publish(root: string, entries: LogEntry[]) {
    const rootDir = path.dirname(root);
    const byFile = new Map<string, vscode.Diagnostic[]>();
    let errors = 0;
    let warnings = 0;
    let badBoxes = 0;
    for (const e of entries) {
      if (e.severity === 'info') continue;
      if (e.severity === 'error') errors++;
      else if (e.severity === 'warning') warnings++;
      else badBoxes++;
      let file = e.file ? path.resolve(rootDir, e.file) : root;
      let lineNo = e.line;
      // BibTeX names the entry ("empty journal in jones2021") but not the file: point at the entry.
      const entryKey = e.tool === 'bibtex' && !e.file ? /\bin (\S+)$/.exec(e.message)?.[1] : undefined;
      const entry = entryKey ? this.projects.findEntry(entryKey) : undefined;
      if (entry) {
        file = entry.bib.path;
        lineNo = entry.entry.line + 1;
        e.file = file;
        e.line = lineNo;
      }
      // Without a line number we report at the top of the file instead of inventing one.
      const line = Math.max(0, (lineNo ?? 1) - 1);
      const range = new vscode.Range(line, 0, line, 1000);
      const severity =
        e.severity === 'error' ? vscode.DiagnosticSeverity.Error : e.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
      const d = new vscode.Diagnostic(range, e.message, severity);
      d.source = e.tool === 'latex' ? 'LaTeX' : e.tool;
      const explanation = explain(e.message, config().get<Rule[]>('errors.extra') ?? []);
      if (explanation) {
        d.code = { value: explanation.id, target: vscode.Uri.parse('command:latexstudio.explainError?' + encodeURIComponent(JSON.stringify([e.message]))) };
        d.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(file), range), `${explanation.title}: ${explanation.fix}`)];
      }
      if (lineNo === undefined) d.message += ' (no line number in the log)';
      byFile.set(file, [...(byFile.get(file) ?? []), d]);
    }
    this.diagnostics.clear();
    for (const [file, list] of byFile) this.diagnostics.set(vscode.Uri.file(file), list);
    this.setState({ ...this.state, errors, warnings, badBoxes });
  }

  private setState(state: BuildState) {
    this.state = state;
    this.stateChanged.fire(state);
  }
}
