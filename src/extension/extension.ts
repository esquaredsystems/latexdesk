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
import { registerSharing } from './sharing';
import { TemplateGallery } from './templateGallery';
import { config, debounce, isBib, isTex } from './util';
import { listGenerated, cleanFiles } from '../build/outputs';
import { countWords } from '../core/wordCount';

export function activate(context: vscode.ExtensionContext) {
  const started = Date.now();
  const log = vscode.window.createOutputChannel('LaTeX Desk');
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
  registerSharing(context, projects);
  new TemplateGallery(context, log).register();
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(BibManagerProvider.viewType, new BibManagerProvider(context, projects, health), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const command = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ---- build ----
  command('latexdesk.build', () => builds.build({ mode: builds.fastPreview ? 'fast' : 'full' }));
  command('latexdesk.buildFast', () => builds.build({ mode: 'fast' }));
  command('latexdesk.buildPartial', () => builds.build({ mode: 'partial' }));
  command('latexdesk.toggleFastPreview', async () => {
    await builds.setFastPreview(!builds.fastPreview);
    void vscode.window.setStatusBarMessage(`LaTeX Desk: fast preview ${builds.fastPreview ? 'on — builds use draft images' : 'off'}`, 3000);
  });
  command('latexdesk.rebuild', () => builds.build({ fromScratch: true }));
  command('latexdesk.stopBuild', () => builds.stop());
  command('latexdesk.buildWithRecipe', async () => {
    const pick = await vscode.window.showQuickPick(builds.recipes().map((r) => ({ label: r.name, description: r.tools.join(' → ') })), { placeHolder: 'Build with recipe' });
    if (pick) await builds.build({ recipe: pick.label });
  });
  command('latexdesk.selectRecipe', async () => {
    const pick = await vscode.window.showQuickPick(builds.recipes().map((r) => ({ label: r.name, description: r.tools.join(' → ') })), { placeHolder: 'Default recipe for this workspace' });
    if (!pick) return;
    await context.workspaceState.update('latexdesk.recipe', pick.label);
    void vscode.window.showInformationMessage(`LaTeX Desk: builds now use "${pick.label}".`);
  });
  command('latexdesk.toggleAutoBuild', async () => {
    const next = config().get('build.autoBuild') === 'onSave' ? 'never' : 'onSave';
    await config().update('build.autoBuild', next, vscode.ConfigurationTarget.Workspace);
    void vscode.window.setStatusBarMessage(`LaTeX Desk: build on save ${next === 'onSave' ? 'on' : 'off'}`, 3000);
  });
  command('latexdesk.compileMenu', async () => {
    const auto = config().get('build.autoBuild') === 'onSave';
    const items = [
      { label: '$(play) Recompile', id: 'latexdesk.build' },
      { label: '$(refresh) Recompile from scratch', id: 'latexdesk.rebuild' },
      ...(builds.isBuilding ? [{ label: '$(debug-stop) Stop build', id: 'latexdesk.stopBuild' }] : []),
      { label: `${auto ? '$(check)' : '$(circle-slash)'} Build on save`, id: 'latexdesk.toggleAutoBuild' },
      { label: `${builds.fastPreview ? '$(check)' : '$(circle-slash)'} Fast preview (draft images)`, id: 'latexdesk.toggleFastPreview' },
      { label: '$(split-horizontal) Build this chapter only', id: 'latexdesk.buildPartial' },
      { label: '$(list-ordered) Select recipe…', id: 'latexdesk.selectRecipe' },
      { label: '$(trash) Clean auxiliary files', id: 'latexdesk.clean' },
      { label: '$(output) Open log viewer', id: 'latexdesk.openLogViewer' },
      { label: '$(open-preview) View PDF', id: 'latexdesk.viewPdf' },
      { label: '$(file-zip) Create Source ZIP (no PDF or build files)', id: 'latexdesk.exportSourceZip' },
      { label: '$(shield) Export PDF with Watermark…', id: 'latexdesk.exportWatermarkedPdf' },
      { label: '$(new-folder) Create from Template…', id: 'latexdesk.createFromTemplate' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Compile options' });
    if (pick) await vscode.commands.executeCommand(pick.id);
  });
  command('latexdesk.clean', async () => {
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
    void vscode.window.setStatusBarMessage(`LaTeX Desk: removed ${removed.length} files`, 3000);
  });
  command('latexdesk.showLog', () => log.show(true));
  command('latexdesk.openLogViewer', () => panels.show('log'));
  command('latexdesk.explainError', (message?: string) => panels.show('log', { focusMessage: message }));
  command('latexdesk.openDashboard', () => panels.show('dashboard'));
  command('latexdesk.exportSubmission', () => exportPanel.show());
  command('latexdesk.checkTools', () => panels.show('tools'));
  command('latexdesk.selectRoot', () => projects.selectRoot());
  command('latexdesk.newProject', () => newProject());

  // ---- PDF ----
  const currentPdf = async () => {
    await projects.refresh();
    const out = projects.output();
    if (!out) void vscode.window.showWarningMessage('LaTeX Desk: no root document found.');
    return out?.pdf;
  };
  command('latexdesk.viewPdf', async () => {
    const pdf = await currentPdf();
    if (pdf) await viewer.open(pdf);
  });
  command('latexdesk.viewPdfExternal', async () => {
    const pdf = await currentPdf();
    if (pdf) await vscode.env.openExternal(vscode.Uri.file(pdf));
  });
  command('latexdesk.refreshPdf', async () => {
    const pdf = await currentPdf();
    if (pdf) await viewer.load(pdf);
  });
  command('latexdesk.revealOutput', async () => {
    const pdf = await currentPdf();
    if (pdf && fs.existsSync(pdf)) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pdf));
  });
  command('latexdesk.syncForward', () => synctex.forward());
  builds.onDidProducePdf(() => {
    if (config().get('viewer.syncAfterBuild') && vscode.window.activeTextEditor && isTex(vscode.window.activeTextEditor.document)) void synctex.forward();
  });

  // ---- output files view ----
  command('latexdesk.revealFile', (node: vscode.TreeItem) => node.resourceUri && vscode.commands.executeCommand('revealFileInOS', node.resourceUri));
  command('latexdesk.copyPath', (node: vscode.TreeItem) => node.resourceUri && vscode.env.clipboard.writeText(node.resourceUri.fsPath));
  command('latexdesk.deleteOutput', async (node: vscode.TreeItem) => {
    if (!node.resourceUri) return;
    const ok = await vscode.window.showWarningMessage(`Delete ${path.basename(node.resourceUri.fsPath)}?`, { modal: true }, 'Delete');
    if (ok !== 'Delete') return;
    const { refused } = cleanFiles([node.resourceUri.fsPath]);
    if (refused.length) void vscode.window.showWarningMessage('LaTeX Desk only deletes generated files.');
    await vscode.commands.executeCommand('latexdesk.refreshViews');
  });

  // ---- bibliography ----
  command('latexdesk.citationBrowser', (initial?: string) => citationBrowser(projects, health, typeof initial === 'string' ? initial : undefined));
  command('latexdesk.scanBibliography', async () => {
    await projects.refresh();
    health.scanAll();
    const target = vscode.window.activeTextEditor && isBib(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor.document.uri : projects.project?.bibFiles[0] ? vscode.Uri.file(projects.project.bibFiles[0]) : undefined;
    if (!target) {
      void vscode.window.showInformationMessage('No bibliography file found in this project.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, BibManagerProvider.viewType);
  });
  command('latexdesk.openBibManager', async (uri?: vscode.Uri) => {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor && isBib(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor.document.uri : projects.project?.bibFiles[0] ? vscode.Uri.file(projects.project.bibFiles[0]) : undefined;
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, BibManagerProvider.viewType);
    else void vscode.window.showInformationMessage('Open a .bib file first.');
  });

  command('latexdesk.openEntryForm', async (uri?: vscode.Uri, key?: string) => {
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
  command('latexdesk.wordCount', async () => {
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
    const parts = [`Project: ≈${ours.toLocaleString()} words (LaTeX Desk)`];
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
