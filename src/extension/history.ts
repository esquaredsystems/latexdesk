// History view (wireframe 1t): local snapshots and labelled versions of the project's sources,
// diff against the current text, restore (with a snapshot of the pre-restore state first) and
// a latexdiff PDF against any snapshot.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { HistoryStore, Snapshot } from '../build/history';
import { BuildRun } from '../build/runner';
import { BUILTIN_TOOLS } from '../build/recipes';
import { ensureStudioDir } from '../build/outputs';
import { BuildManager } from './buildManager';
import { ProjectManager } from './projectManager';
import { PdfViewerManager } from './pdfViewer';
import { ToolRegistry } from './toolRegistry';
import { config } from './util';

const SCHEME = 'latexstudio-history';

type Node = { snapshot: Snapshot; file?: string };

export class ProjectHistory implements vscode.TreeDataProvider<Node>, vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private view?: vscode.TreeView<Node>;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly projects: ProjectManager,
    private readonly builds: BuildManager,
    private readonly viewer: PdfViewerManager,
    private readonly tools: ToolRegistry,
  ) {}

  register(context: vscode.ExtensionContext) {
    this.view = vscode.window.createTreeView('latexstudio.history', { treeDataProvider: this, showCollapseAll: true });
    const command = (id: string, fn: (node?: Node) => unknown) => this.disposables.push(vscode.commands.registerCommand(id, fn));
    this.disposables.push(
      this.view,
      this.changed,
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      this.projects.onDidChange(() => this.refresh()),
      // A successful full build is a natural checkpoint.
      this.builds.onDidChangeState((s) => {
        if (s.phase === 'succeeded' && s.mode !== 'fast' && s.mode !== 'partial') this.snapshot('successful build');
      }),
    );
    command('latexstudio.history.snapshot', () => {
      const s = this.snapshot('manual');
      void vscode.window.setStatusBarMessage(s ? 'LaTeX Studio: snapshot saved' : 'LaTeX Studio: nothing changed since the last snapshot', 3000);
    });
    command('latexstudio.history.label', (node) => this.label(node));
    command('latexstudio.history.diff', (node) => node && this.diff(node));
    command('latexstudio.history.restoreFile', (node) => node?.file && this.restore(node.snapshot, [node.file]));
    command('latexstudio.history.restoreProject', (node) => node && this.restore(node.snapshot));
    command('latexstudio.history.latexdiff', (node) => this.latexdiff(node?.snapshot));
    command('latexstudio.history.refresh', () => this.refresh());
    context.subscriptions.push(this);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  private store(): HistoryStore | undefined {
    return this.projects.root ? new HistoryStore(path.dirname(this.projects.root)) : undefined;
  }

  /** Source files that belong in a snapshot: .tex files, bibliographies and local class/style files. */
  private sourceFiles(): string[] {
    const project = this.projects.project;
    if (!project) return [];
    const inside = (f: string) => !path.relative(project.rootDir, f).startsWith('..');
    return [...project.files.map((f) => f.path), ...project.bibFiles, ...project.styleFiles].filter(inside);
  }

  snapshot(reason: string, label?: string): Snapshot | undefined {
    const store = this.store();
    if (!store || !vscode.workspace.isTrusted) return undefined;
    ensureStudioDir(store.projectDir);
    const max = config().get<number>('history.maxSnapshots') ?? 200;
    const s = store.take(this.sourceFiles(), reason, label, { maxSnapshots: max });
    if (s) this.refresh();
    return s;
  }

  refresh() {
    this.changed.fire(undefined);
    const store = this.store();
    if (this.view) this.view.description = store ? `${(store.size() / 1024).toFixed(0)} KB` : undefined;
  }

  // ---- tree ----
  getChildren(node?: Node): Node[] {
    const store = this.store();
    if (!store) return [];
    if (!node) return store.list().reverse().map((snapshot) => ({ snapshot }));
    if (node.file) return [];
    const changed = new Set(store.changedFiles(node.snapshot));
    return Object.keys(node.snapshot.files)
      .sort((a, b) => Number(changed.has(b)) - Number(changed.has(a)) || a.localeCompare(b))
      .map((file) => ({ snapshot: node.snapshot, file }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.file) {
      const store = this.store()!;
      const changed = store.changedFiles({ ...node.snapshot, files: { [node.file]: node.snapshot.files[node.file] } }).length > 0;
      const item = new vscode.TreeItem(node.file, vscode.TreeItemCollapsibleState.None);
      item.description = changed ? 'changed since' : 'unchanged';
      item.iconPath = new vscode.ThemeIcon(changed ? 'diff-modified' : 'file');
      item.contextValue = 'historyFile';
      item.command = { command: 'latexstudio.history.diff', title: 'Diff with current', arguments: [node] };
      return item;
    }
    const s = node.snapshot;
    const item = new vscode.TreeItem(s.label ?? `Snapshot · ${s.reason}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = relativeTime(s.time);
    item.tooltip = `${new Date(s.time).toLocaleString()} · ${Object.keys(s.files).length} files${s.label ? ` · ${s.reason}` : ''}`;
    item.iconPath = new vscode.ThemeIcon(s.label ? 'tag' : 'history');
    item.contextValue = 'historySnapshot';
    return item;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const store = this.store();
    const snapshot = store?.list().find((s) => s.id === uri.query);
    return (snapshot && store!.read(snapshot, uri.path.replace(/^\//, ''))?.toString('utf8')) ?? '';
  }

  // ---- actions ----
  private async label(node?: Node) {
    const name = await vscode.window.showInputBox({ prompt: node ? 'Label for this snapshot' : 'Label the current version', placeHolder: 'Submitted to journal, v1', value: node?.snapshot.label });
    if (name === undefined) return;
    if (node) {
      this.store()?.setLabel(node.snapshot.id, name.trim());
      this.refresh();
    } else if (name.trim()) {
      this.snapshot('labelled version', name.trim());
    }
  }

  private async diff(node: Node) {
    const store = this.store();
    if (!store) return;
    const file = node.file ?? store.changedFiles(node.snapshot)[0] ?? Object.keys(node.snapshot.files)[0];
    if (!file) return;
    const left = vscode.Uri.from({ scheme: SCHEME, path: '/' + file, query: node.snapshot.id });
    const right = vscode.Uri.file(path.join(store.projectDir, file));
    const title = `${path.basename(file)} (${node.snapshot.label ?? new Date(node.snapshot.time).toLocaleString()}) ↔ current`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  private async restore(snapshot: Snapshot, only?: string[]) {
    const store = this.store();
    if (!store) return;
    const files = only ?? store.changedFiles(snapshot);
    if (!files.length) {
      void vscode.window.showInformationMessage('The current files already match this snapshot.');
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      `Restore ${files.length} file${files.length > 1 ? 's' : ''} from ${snapshot.label ?? new Date(snapshot.time).toLocaleString()}?`,
      { modal: true, detail: `${files.join('\n')}\n\nThe current state is saved as a snapshot first, so this can be undone.` },
      'Restore',
    );
    if (ok !== 'Restore') return;
    for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && files.some((f) => doc.fileName === path.join(store.projectDir, f))) await doc.save();
    store.take(this.sourceFiles(), 'before restore', undefined, { maxSnapshots: config().get<number>('history.maxSnapshots') ?? 200 });
    const restored = store.restore(snapshot, files);
    this.refresh();
    void vscode.window.showInformationMessage(`Restored ${restored.length} file${restored.length > 1 ? 's' : ''}.`);
  }

  /** Builds a PDF that marks the changes between a snapshot and the current text (needs latexdiff). */
  private async latexdiff(snapshot?: Snapshot) {
    const store = this.store();
    const root = this.projects.root;
    if (!store || !root || !vscode.workspace.isTrusted) return;
    const latexdiff = await this.tools.path('latexdiff');
    if (!latexdiff) {
      void vscode.window.showWarningMessage('LaTeX Studio: latexdiff is not installed. It comes with TeX Live and MiKTeX (package "latexdiff").');
      return;
    }
    if (!snapshot) {
      const picks = store.list().reverse().map((s) => ({ label: s.label ?? `Snapshot · ${s.reason}`, description: new Date(s.time).toLocaleString(), s }));
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Compare the current text with…' });
      if (!pick) return;
      snapshot = pick.s;
    }
    const rootDir = path.dirname(root);
    const rootRel = path.relative(rootDir, root);
    const diffDir = path.join(rootDir, '.latexstudio', 'diff');
    const oldDir = path.join(diffDir, 'old');
    fs.rmSync(oldDir, { recursive: true, force: true });
    store.materialize(snapshot, oldDir);
    const job = path.basename(root, '.tex') + '-diff';

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'latexdiff', cancellable: true }, async (progress, token) => {
      progress.report({ message: 'comparing sources…' });
      const tex = await new Promise<string | undefined>((resolve) => {
        const child = execFile(latexdiff, ['--flatten', path.join(oldDir, rootRel), root], { cwd: rootDir, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            void vscode.window.showErrorMessage(`latexdiff failed: ${stderr.split('\n')[0] || err.message}`);
            resolve(undefined);
          } else resolve(stdout);
        });
        token.onCancellationRequested(() => child.kill());
      });
      if (!tex || token.isCancellationRequested) return;
      fs.writeFileSync(path.join(diffDir, job + '.tex'), tex);

      progress.report({ message: 'building the diff PDF…' });
      // The diff file lives in .latexstudio/diff; TEXINPUTS/BIBINPUTS let it find figures, classes and .bib files.
      const search = rootDir + path.delimiter;
      const run = new BuildRun({
        recipe: { name: 'latexdiff', tools: ['latexmk'] },
        tools: BUILTIN_TOOLS,
        placeholders: { DOC: job, DOCFILE: job, DOC_EXT: job + '.tex', DIR: diffDir, OUTDIR: diffDir, PATHSEP: path.delimiter },
        env: { TEXINPUTS: search, BIBINPUTS: search },
        executablePaths: config().get<Record<string, string>>('tools.paths') ?? {},
      });
      token.onCancellationRequested(() => run.cancel());
      await run.run();
      const pdf = path.join(diffDir, job + '.pdf');
      if (fs.existsSync(pdf)) await this.viewer.open(pdf);
      else void vscode.window.showErrorMessage(`The diff PDF could not be built. See ${path.join(diffDir, job + '.log')}.`);
    });
  }
}

function relativeTime(t: number): string {
  const minutes = Math.round((Date.now() - t) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(t).toLocaleDateString();
}
