// Keeps track of the root document, the files it includes and the bibliographies it uses.
// Everything is re-read lazily and incrementally: a change to one file only re-parses that file.
import * as vscode from 'vscode';
import * as path from 'path';
import { loadProject, detectRoot, Project, FileHost, RootCandidate } from '../core/project';
import { parseTex, TexFileIndex, Label } from '../core/texParser';
import { parseBib, BibFile, BibEntry } from '../core/bibParser';
import { config, debounce, exists, isBib, isTex, readText, samePath } from './util';

export interface BibRecord {
  path: string;
  text: string;
  file: BibFile;
}

const host: FileHost = { readFile: readText, exists };

export class ProjectManager implements vscode.Disposable {
  project?: Project;
  readonly bibs = new Map<string, BibRecord>();
  private parseCache = new Map<string, TexFileIndex>();
  private candidates?: string[];
  private manualRoot?: string;
  private disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private refreshing?: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
    this.manualRoot = context.workspaceState.get<string>('latexdesk.manualRoot');
    const scheduleRefresh = debounce(() => void this.refresh(), 250);

    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length === 0) return;
        if (isTex(e.document)) {
          this.parseCache.delete(path.normalize(e.document.fileName));
          scheduleRefresh();
        } else if (isBib(e.document) && this.bibs.has(path.normalize(e.document.fileName))) {
          this.bibs.delete(path.normalize(e.document.fileName));
          scheduleRefresh();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && isTex(editor.document) && !this.isInProject(editor.document.fileName)) scheduleRefresh();
      }),
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,bib,cls,sty}');
    const onDisk = (uri: vscode.Uri) => {
      this.parseCache.delete(path.normalize(uri.fsPath));
      this.bibs.delete(path.normalize(uri.fsPath));
      if (uri.fsPath.endsWith('.tex')) this.candidates = undefined;
      scheduleRefresh();
    };
    watcher.onDidCreate(onDisk);
    watcher.onDidDelete(onDisk);
    watcher.onDidChange((uri) => {
      // Saved editors already triggered a refresh through onDidChangeTextDocument.
      if (!vscode.workspace.textDocuments.some((d) => samePath(d.fileName, uri.fsPath))) onDisk(uri);
    });
    this.disposables.push(watcher);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  get root(): string | undefined {
    return this.project?.root;
  }

  isInProject(file: string): boolean {
    return !!this.project?.files.some((f) => samePath(f.path, file)) || !!this.project?.bibFiles.some((b) => samePath(b, file));
  }

  /** Re-detects the root (if needed) and reloads the project. Concurrent calls share one run. */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => (this.refreshing = undefined));
    }
    return this.refreshing;
  }

  private async doRefresh() {
    const root = await this.findRoot();
    if (!root) {
      if (this.project) {
        this.project = undefined;
        this.changed.fire();
      }
      return;
    }
    const cache = { get: (f: string) => this.parseCache.get(f), set: (f: string, i: TexFileIndex) => this.parseCache.set(f, i) };
    const t0 = Date.now();
    this.project = await loadProject(root, host, cache);
    for (const bib of this.project.bibFiles) {
      if (this.bibs.has(bib)) continue;
      const text = await readText(bib);
      if (text !== undefined) this.bibs.set(bib, { path: bib, text, file: parseBib(text) });
    }
    for (const key of [...this.bibs.keys()]) if (!this.project.bibFiles.includes(key)) this.bibs.delete(key);
    this.log.appendLine(`[project] ${path.basename(root)}: ${this.project.files.length} files, ${this.project.bibFiles.length} bib files, indexed in ${Date.now() - t0} ms`);
    void vscode.commands.executeCommand('setContext', 'latexdesk.hasRoot', true);
    this.changed.fire();
  }

  private async findRoot(): Promise<string | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const configured = config(folder?.uri).get<string>('rootFile');
    if (configured && folder) {
      const full = path.resolve(folder.uri.fsPath, configured);
      if (await exists(full)) return full;
    }
    if (this.manualRoot && (await exists(this.manualRoot))) return this.manualRoot;

    const active = vscode.window.activeTextEditor?.document;
    const activeFile = active && isTex(active) ? path.normalize(active.fileName) : undefined;
    // Keep the current root while working in one of its files.
    if (this.project && activeFile && this.isInProject(activeFile)) return this.project.root;
    if (this.project && !activeFile) return this.project.root;

    const candidates = await this.rootCandidates(activeFile);
    const result = await detectRoot(activeFile, candidates, host);
    if (result.root) return path.normalize(result.root);
    if (result.ambiguous) {
      // Ask rather than silently building the wrong document.
      const pick = await vscode.window.showQuickPick(
        result.ambiguous.map((p) => ({ label: path.basename(p), description: vscode.workspace.asRelativePath(p), path: p })),
        { placeHolder: `LaTeX Desk: choose the root document (${result.reason})` },
      );
      if (pick) {
        this.setManualRoot(pick.path);
        return pick.path;
      }
    }
    return this.project?.root;
  }

  private async rootCandidates(activeFile?: string): Promise<RootCandidate[]> {
    if (!this.candidates) {
      const exclude = config().get<string[]>('exclude') ?? [];
      const uris = await vscode.workspace.findFiles('**/*.tex', exclude.length ? `{${exclude.join(',')}}` : undefined, 2000);
      this.candidates = uris.map((u) => path.normalize(u.fsPath));
    }
    const files = new Set(this.candidates);
    if (activeFile) files.add(activeFile);
    const result: RootCandidate[] = [];
    for (const file of files) {
      let index = this.parseCache.get(file);
      if (!index) {
        const text = await readText(file);
        if (text === undefined) continue;
        index = parseTex(text);
        this.parseCache.set(file, index);
      }
      result.push({ path: file, index });
    }
    return result;
  }

  setManualRoot(file: string | undefined) {
    this.manualRoot = file;
    void this.context.workspaceState.update('latexdesk.manualRoot', file);
  }

  async selectRoot() {
    const candidates = (await this.rootCandidates()).filter((c) => c.index.documentClass && c.index.hasBeginDocument);
    const items = [
      { label: '$(search) Detect automatically', path: undefined as string | undefined },
      ...candidates.map((c) => ({ label: path.basename(c.path), description: vscode.workspace.asRelativePath(c.path), path: c.path as string | undefined })),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Root document' });
    if (!pick) return;
    this.setManualRoot(pick.path);
    this.project = undefined;
    await this.refresh();
  }

  /** True for files the root document loads before \begin{document} (preamble files hold no prose). */
  isPreambleFile(file: string): boolean {
    const project = this.project;
    if (!project) return false;
    let child = path.normalize(file);
    while (project.parents.get(child) && project.parents.get(child) !== project.root) child = project.parents.get(child)!;
    if (project.parents.get(child) !== project.root) return false;
    const root = project.files.find((f) => f.path === project.root);
    const begin = root?.index.beginDocumentOffset;
    const include = root?.children.find((c) => samePath(c.path, child));
    return begin !== undefined && !!include && include.offset < begin;
  }

  /** Parsed index of one file (from the project or parsed on demand). */
  index(file: string): TexFileIndex | undefined {
    const key = path.normalize(file);
    return this.project?.files.find((f) => samePath(f.path, key))?.index ?? this.parseCache.get(key);
  }

  indexDocument(doc: vscode.TextDocument): TexFileIndex {
    const key = path.normalize(doc.fileName);
    let index = this.parseCache.get(key);
    if (!index) {
      index = parseTex(doc.getText());
      this.parseCache.set(key, index);
    }
    return index;
  }

  allLabels(): { label: Label; file: string }[] {
    const result: { label: Label; file: string }[] = [];
    for (const f of this.project?.files ?? []) for (const label of f.index.labels) result.push({ label, file: f.path });
    return result;
  }

  bibEntries(): { entry: BibEntry; bib: BibRecord }[] {
    const result: { entry: BibEntry; bib: BibRecord }[] = [];
    for (const bib of this.bibs.values()) for (const entry of bib.file.entries) result.push({ entry, bib });
    return result;
  }

  findEntry(key: string): { entry: BibEntry; bib: BibRecord } | undefined {
    for (const bib of this.bibs.values()) {
      const entry = bib.file.entries.find((e) => e.key === key);
      if (entry) return { entry, bib };
    }
    return undefined;
  }

  citedKeys(): Map<string, { file: string; line: number }[]> {
    const map = new Map<string, { file: string; line: number }[]>();
    for (const f of this.project?.files ?? []) {
      for (const c of f.index.citations) {
        const list = map.get(c.key) ?? [];
        list.push({ file: f.path, line: c.line });
        map.set(c.key, list);
      }
    }
    return map;
  }

  /** All \usepackage names in the project, for dialect detection and completion. */
  packages(): string[] {
    return (this.project?.files ?? []).flatMap((f) => f.index.packages.map((p) => p.name));
  }

  /** Output directory and job name for the current root. */
  output(root = this.root): { outDir: string; jobName: string; pdf: string } | undefined {
    if (!root) return undefined;
    const rootDir = path.dirname(root);
    const jobName = path.basename(root, path.extname(root));
    const setting = (config(vscode.Uri.file(root)).get<string>('build.outDir') ?? '').trim();
    const outDir = setting ? path.resolve(rootDir, setting.replace(/%DIR%/g, rootDir).replace(/%DOCNAME%/g, jobName)) : rootDir;
    return { outDir, jobName, pdf: path.join(outDir, jobName + '.pdf') };
  }
}
