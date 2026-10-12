// Entry point. Activation only creates objects and registers commands; the workspace scan,
// tool detection and indexing start afterwards, in the background.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { ProjectManager } from './projectManager';
import { BuildManager } from './buildManager';
import { ToolRegistry } from './toolRegistry';
import { PdfViewerManager } from './pdfViewer';
import { SyncTexService } from './syncTex';
import { StatusBar } from './statusBar';
import { registerLanguageFeatures } from './languageFeatures';
import { registerEditingCommands } from './editing';
import { registerRename } from './rename';
import { LiveChecks } from './liveChecks';
import { BibHealth, citationBrowser } from './bibFeatures';
import { BibManagerProvider } from './bibManager';
import { BibEntryForm } from './bibEntryForm';
import { ProjectHistory } from './history';
import { ExportPanel } from './exportPanel';
import { SpellChecker } from './spell';
import { TableWizard } from './tableWizard';
import { registerViews } from './views';
import { Panels } from './panels';
import { EditorToolbar } from './toolbar';
import { ToolsView } from './toolsView';
import { registerFormatter } from './formatter';
import { newProject } from './newProject';
import { config, debounce, isBib, isTex } from './util';
import { listGenerated, cleanFiles } from '../build/outputs';
import { countWords } from '../core/wordCount';

export function activate(context: vscode.ExtensionContext) {
  const started = Date.now();
  const log = vscode.window.createOutputChannel('LaTeX Studio');
  const tools = new ToolRegistry(log);
  const projects = new ProjectManager(context, log);
  const builds = new BuildManager(context, projects, tools, log);
  const viewer = new PdfViewerManager(context, builds, projects);
  const synctex = new SyncTexService(projects, viewer, log);
  const health = new BibHealth(projects);
  const checks = new LiveChecks(projects, health);
  const status = new StatusBar(projects, builds, context);
  const activation = { activatedInMs: 0 };
  const panels = new Panels(context, projects, builds, health, tools, activation);
  const entryForm = new BibEntryForm(context, health);
  new ProjectHistory(projects, builds, viewer, tools).register(context);
  const exportPanel = new ExportPanel(context, projects);
  context.subscriptions.push(exportPanel, new SpellChecker(context, projects));
  new TableWizard(context, projects).register();
  context.subscriptions.push(log, projects, builds, viewer, synctex, health, checks, status, panels, entryForm);

  health.register(context);
  registerLanguageFeatures(context, projects, (key) => health.entryScore(key));
  registerEditingCommands(context);
  registerRename(context, projects);
  const toolbar = new EditorToolbar(projects);
  toolbar.register(context);
  new ToolsView(context, toolbar).register();
  registerFormatter(context);
  registerViews(context, projects, builds, health);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(BibManagerProvider.viewType, new BibManagerProvider(context, projects, health), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const command = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ---- build ----
  command('latexstudio.build', () => builds.build({ mode: builds.fastPreview ? 'fast' : 'full' }));
  command('latexstudio.buildFast', () => builds.build({ mode: 'fast' }));
  command('latexstudio.buildPartial', () => builds.build({ mode: 'partial' }));
  command('latexstudio.toggleFastPreview', async () => {
    await builds.setFastPreview(!builds.fastPreview);
    void vscode.window.setStatusBarMessage(`LaTeX Studio: fast preview ${builds.fastPreview ? 'on — builds use draft images' : 'off'}`, 3000);
  });
  command('latexstudio.rebuild', () => builds.build({ fromScratch: true }));
  command('latexstudio.stopBuild', () => builds.stop());
  command('latexstudio.buildWithRecipe', async () => {
    const pick = await vscode.window.showQuickPick(builds.recipes().map((r) => ({ label: r.name, description: r.tools.join(' → ') })), { placeHolder: 'Build with recipe' });
    if (pick) await builds.build({ recipe: pick.label });
  });
  command('latexstudio.selectRecipe', async () => {
    const pick = await vscode.window.showQuickPick(builds.recipes().map((r) => ({ label: r.name, description: r.tools.join(' → ') })), { placeHolder: 'Default recipe for this workspace' });
    if (!pick) return;
    await context.workspaceState.update('latexstudio.recipe', pick.label);
    void vscode.window.showInformationMessage(`LaTeX Studio: builds now use "${pick.label}".`);
  });
  command('latexstudio.toggleAutoBuild', async () => {
    const next = config().get('build.autoBuild') === 'onSave' ? 'never' : 'onSave';
    await config().update('build.autoBuild', next, vscode.ConfigurationTarget.Workspace);
    void vscode.window.setStatusBarMessage(`LaTeX Studio: build on save ${next === 'onSave' ? 'on' : 'off'}`, 3000);
  });
  command('latexstudio.compileMenu', async () => {
    const auto = config().get('build.autoBuild') === 'onSave';
    const items = [
      { label: '$(play) Recompile', id: 'latexstudio.build' },
      { label: '$(refresh) Recompile from scratch', id: 'latexstudio.rebuild' },
      ...(builds.isBuilding ? [{ label: '$(debug-stop) Stop build', id: 'latexstudio.stopBuild' }] : []),
      { label: `${auto ? '$(check)' : '$(circle-slash)'} Build on save`, id: 'latexstudio.toggleAutoBuild' },
      { label: `${builds.fastPreview ? '$(check)' : '$(circle-slash)'} Fast preview (draft images)`, id: 'latexstudio.toggleFastPreview' },
      { label: '$(split-horizontal) Build this chapter only', id: 'latexstudio.buildPartial' },
      { label: '$(list-ordered) Select recipe…', id: 'latexstudio.selectRecipe' },
      { label: '$(trash) Clean auxiliary files', id: 'latexstudio.clean' },
      { label: '$(output) Open log viewer', id: 'latexstudio.openLogViewer' },
      { label: '$(open-preview) View PDF', id: 'latexstudio.viewPdf' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Compile options' });
    if (pick) await vscode.commands.executeCommand(pick.id);
  });
  command('latexstudio.clean', async () => {
    await projects.refresh();
    const out = projects.output();
    if (!out) return;
    const files = listGenerated(out.outDir, out.jobName, config().get<string[]>('build.cleanExtensions') ?? []);
    if (!files.length) {
      void vscode.window.showInformationMessage('Nothing to clean.');
      return;
    }
    const detail = files.map((f) => path.basename(f)).join('\n');
    const ok = await vscode.window.showWarningMessage(`Delete ${files.length} generated file${files.length > 1 ? 's' : ''}?`, { modal: true, detail }, 'Delete');
    if (ok !== 'Delete') return;
    const { removed, refused } = cleanFiles(files);
    log.appendLine(`[clean] removed ${removed.length} files${refused.length ? `; kept ${refused.join(', ')}` : ''}`);
    void vscode.window.setStatusBarMessage(`LaTeX Studio: removed ${removed.length} files`, 3000);
  });
  command('latexstudio.showLog', () => log.show(true));
  command('latexstudio.openLogViewer', () => panels.show('log'));
  command('latexstudio.explainError', (message?: string) => panels.show('log', { focusMessage: message }));
  command('latexstudio.openDashboard', () => panels.show('dashboard'));
  command('latexstudio.exportSubmission', () => exportPanel.show());
  command('latexstudio.checkTools', () => panels.show('tools'));
  command('latexstudio.selectRoot', () => projects.selectRoot());
  command('latexstudio.newProject', () => newProject());

  // ---- PDF ----
  const currentPdf = async () => {
    await projects.refresh();
    const out = projects.output();
    if (!out) void vscode.window.showWarningMessage('LaTeX Studio: no root document found.');
    return out?.pdf;
  };
  command('latexstudio.viewPdf', async () => {
    const pdf = await currentPdf();
    if (pdf) await viewer.open(pdf);
  });
  command('latexstudio.viewPdfExternal', async () => {
    const pdf = await currentPdf();
    if (pdf) await vscode.env.openExternal(vscode.Uri.file(pdf));
  });
  command('latexstudio.refreshPdf', async () => {
    const pdf = await currentPdf();
    if (pdf) await viewer.load(pdf);
  });
  command('latexstudio.revealOutput', async () => {
    const pdf = await currentPdf();
    if (pdf && fs.existsSync(pdf)) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pdf));
  });
  command('latexstudio.syncForward', () => synctex.forward());
  builds.onDidProducePdf(() => {
    if (config().get('viewer.syncAfterBuild') && vscode.window.activeTextEditor && isTex(vscode.window.activeTextEditor.document)) void synctex.forward();
  });

  // ---- output files view ----
  command('latexstudio.revealFile', (node: vscode.TreeItem) => node.resourceUri && vscode.commands.executeCommand('revealFileInOS', node.resourceUri));
  command('latexstudio.copyPath', (node: vscode.TreeItem) => node.resourceUri && vscode.env.clipboard.writeText(node.resourceUri.fsPath));
  command('latexstudio.deleteOutput', async (node: vscode.TreeItem) => {
    if (!node.resourceUri) return;
    const ok = await vscode.window.showWarningMessage(`Delete ${path.basename(node.resourceUri.fsPath)}?`, { modal: true }, 'Delete');
    if (ok !== 'Delete') return;
    const { refused } = cleanFiles([node.resourceUri.fsPath]);
    if (refused.length) void vscode.window.showWarningMessage('LaTeX Studio only deletes generated files.');
    await vscode.commands.executeCommand('latexstudio.refreshViews');
  });

  // ---- bibliography ----
  command('latexstudio.citationBrowser', (initial?: string) => citationBrowser(projects, health, typeof initial === 'string' ? initial : undefined));
  command('latexstudio.scanBibliography', async () => {
    await projects.refresh();
    health.scanAll();
    const target = vscode.window.activeTextEditor && isBib(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor.document.uri : projects.project?.bibFiles[0] ? vscode.Uri.file(projects.project.bibFiles[0]) : undefined;
    if (!target) {
      void vscode.window.showInformationMessage('No bibliography file found in this project.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, BibManagerProvider.viewType);
  });
  command('latexstudio.openBibManager', async (uri?: vscode.Uri) => {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor && isBib(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor.document.uri : projects.project?.bibFiles[0] ? vscode.Uri.file(projects.project.bibFiles[0]) : undefined;
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, BibManagerProvider.viewType);
    else void vscode.window.showInformationMessage('Open a .bib file first.');
  });

  command('latexstudio.openEntryForm', async (uri?: vscode.Uri, key?: string) => {
    const doc = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : undefined;
    await entryForm.show(doc, typeof key === 'string' ? key : undefined);
  });

  // ---- word count ----
  const projectWords = () => {
    let total = 0;
    for (const f of projects.project?.files ?? []) {
      const text = vscode.workspace.textDocuments.find((d) => d.fileName === f.path)?.getText() ?? safeRead(f.path);
      total += countWords(text, { documentOnly: f.path === projects.root });
    }
    return total;
  };
  const updateWords = debounce(() => status.setWordCount(projects.project ? projectWords() : undefined), 1500);
  context.subscriptions.push(projects.onDidChange(updateWords));
  command('latexstudio.wordCount', async () => {
    await projects.refresh();
    if (!projects.root) return;
    const ours = projectWords();
    const editor = vscode.window.activeTextEditor;
    const fileWords = editor && isTex(editor.document) ? countWords(editor.document.getText(), { documentOnly: editor.document.fileName === projects.root }) : undefined;
    const texcount = await tools.path('texcount');
    let tc = '';
    if (texcount && vscode.workspace.isTrusted) {
      tc = await new Promise((resolve) =>
        execFile(texcount, ['-merge', '-1', '-sum', path.basename(projects.root!)], { cwd: path.dirname(projects.root!), timeout: 20000 }, (err, out) => resolve(err ? '' : out.trim().split(/\s/)[0])),
      );
    }
    const parts = [`Project: ≈${ours.toLocaleString()} words (LaTeX Studio)`];
    if (tc) parts.push(`texcount: ${Number(tc).toLocaleString()}`);
    if (fileWords !== undefined) parts.push(`this file: ≈${fileWords.toLocaleString()}`);
    void vscode.window.showInformationMessage(`${parts.join(' · ')}. Counts are approximate and may differ from publisher counts.`);
  });

  // Background start-up work.
  activation.activatedInMs = Date.now() - started;
  log.appendLine(`[activate] commands registered in ${activation.activatedInMs} ms`);
  setTimeout(() => {
    void projects.refresh().then(() => health.scanAll());
    void tools.list();
  }, 0);
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function deactivate() {
  // Disposables registered on the context (builds, watchers, panels) are cleaned up by VS Code.
}
