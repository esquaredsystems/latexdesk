// "Create from Template" (OL-50 to OL-57): a gallery webview over the online template catalog,
// with a cached copy for offline use, and safe extraction of the chosen template's ZIP.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { Catalog, CATALOG_VERSION, parseCatalog, Template } from '../core/templates';
import { download, extractProject } from '../build/templateFiles';
import { config, webviewHtml } from './util';

const DEFAULT_CATALOG = 'https://raw.githubusercontent.com/esquaredsystems/latexdesk/main/templates/templates.json';
const CACHE_FILE = 'templates-catalog.json';
const PENDING_KEY = 'latexdesk.templates.pendingOpen';
const ONE_HOUR = 60 * 60 * 1000;
const CATALOG_LIMIT = 5 * 1024 * 1024;
const ZIP_LIMIT = 50 * 1024 * 1024;

interface CachedCatalog {
  url: string;
  fetchedAt: number;
  json: unknown;
}

export class TemplateGallery implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private catalog?: Catalog;
  private busy = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {}

  register() {
    this.context.subscriptions.push(this, vscode.commands.registerCommand('latexdesk.createFromTemplate', () => this.show()));
    void this.openPending();
  }

  dispose() {
    this.panel?.dispose();
  }

  show() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('latexdesk.templates', 'Create from Template', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = webviewHtml(this.panel.webview, this.context.extensionUri, {
      title: 'Create from Template',
      script: 'dist/webview/templateGallery.js',
      styles: ['media/templates.css'],
    });
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.panel.onDidDispose(() => (this.panel = undefined));
  }

  private async onMessage(msg: { type: string; id?: string }) {
    const template = this.catalog?.templates.find((t) => t.id === msg.id);
    switch (msg.type) {
      case 'ready':
        await this.sendCatalog(false);
        break;
      case 'refresh':
        await this.sendCatalog(true);
        break;
      case 'create':
        if (template) await this.run(() => this.createFromCatalog(template));
        break;
      case 'createFromZip':
        await this.run(() => this.createFromZipFile(template));
        break;
      case 'blank':
        await vscode.commands.executeCommand('latexdesk.newProject');
        break;
      case 'openSource':
        if (template?.source?.startsWith('https://')) await vscode.env.openExternal(vscode.Uri.parse(template.source));
        break;
    }
  }

  private post(message: Record<string, unknown>) {
    void this.panel?.webview.postMessage(message);
  }

  /** One creation at a time; the webview shows a busy line meanwhile. */
  private async run(task: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    try {
      await task();
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not create the project: ${(err as Error).message}`);
    } finally {
      this.busy = false;
      this.post({ type: 'busy', text: '' });
    }
  }

  // ---- catalog ----

  private catalogUrl(): string {
    return (config().get<string>('templates.catalogUrl') || DEFAULT_CATALOG).trim();
  }

  private async sendCatalog(force: boolean) {
    this.post({ type: 'loading' });
    const { catalog, status } = await this.loadCatalog(force);
    this.catalog = catalog;
    this.post({
      type: 'catalog',
      templates: catalog?.templates ?? [],
      status,
      newerFormat: !!catalog && catalog.version > CATALOG_VERSION,
      skipped: catalog?.skipped ?? 0,
    });
  }

  /** The cached catalog when it is recent, otherwise a fresh download, falling back to the cache. */
  private async loadCatalog(force: boolean): Promise<{ catalog?: Catalog; status: string }> {
    const url = this.catalogUrl();
    const cache = this.readCache(url);
    const cachedOn = cache ? new Date(cache.fetchedAt).toLocaleDateString() : '';
    if (cache && !force && Date.now() - cache.fetchedAt < ONE_HOUR) return { catalog: parseCatalog(cache.json), status: 'Template library' };
    if (config().get<boolean>('network.enabled') === false) {
      return cache
        ? { catalog: parseCatalog(cache.json), status: `Network features are off; showing the library from ${cachedOn}` }
        : { status: 'Network features are off (latexdesk.network.enabled), so the template library cannot be downloaded.' };
    }
    try {
      const text = new TextDecoder().decode(await download(url, CATALOG_LIMIT, 10_000));
      const json = JSON.parse(text);
      await this.writeCache({ url, fetchedAt: Date.now(), json });
      return { catalog: parseCatalog(json), status: 'Template library' };
    } catch (err) {
      this.log.appendLine(`[templates] could not load ${url}: ${(err as Error).message}`);
      return cache
        ? { catalog: parseCatalog(cache.json), status: `Offline: showing the library from ${cachedOn}` }
        : { status: `Could not load the template library (${(err as Error).message}).` };
    }
  }

  private readCache(url: string): CachedCatalog | undefined {
    try {
      const cache = JSON.parse(fs.readFileSync(vscode.Uri.joinPath(this.context.globalStorageUri, CACHE_FILE).fsPath, 'utf8')) as CachedCatalog;
      return cache.url === url ? cache : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCache(cache: CachedCatalog) {
    await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.promises.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, CACHE_FILE).fsPath, JSON.stringify(cache));
  }

  // ---- creating a project ----

  private async createFromCatalog(template: Template) {
    if (!template.filename) {
      await this.createFromZipFile(template);
      return;
    }
    if (config().get<boolean>('network.enabled') === false) {
      void vscode.window.showWarningMessage('Network features are off (latexdesk.network.enabled). Download the ZIP yourself and use "From a ZIP file on disk".');
      return;
    }
    const zipUrl = new URL(template.filename, this.catalogUrl()).toString();
    if (!zipUrl.startsWith('https://')) throw new Error(`refusing a template address that is not https: ${zipUrl}`);
    const folder = await this.askForFolder(template.id);
    if (!folder) return;
    this.post({ type: 'busy', text: `Downloading ${template.name}…` });
    const data = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading ${template.name}`, cancellable: true },
      (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        return download(zipUrl, ZIP_LIMIT, 60_000, abort.signal);
      },
    );
    await this.finish(data, folder, template);
  }

  private async createFromZipFile(template?: Template) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'ZIP archive': ['zip'] },
      openLabel: 'Create project from this ZIP',
      title: template ? `ZIP of the ${template.name} template` : 'Template or project ZIP',
    });
    if (!picked?.[0]) return;
    const folder = await this.askForFolder(template?.id ?? path.basename(picked[0].fsPath, '.zip'));
    if (!folder) return;
    await this.finish(await fs.promises.readFile(picked[0].fsPath), folder, template);
  }

  /** Parent folder plus a new (or empty) project folder name. */
  private async askForFolder(defaultName: string): Promise<string | undefined> {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
    const parent = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      defaultUri: workspace ? vscode.Uri.joinPath(workspace, '..') : undefined,
      openLabel: 'Create the project in this folder',
    });
    if (!parent?.[0]) return undefined;
    const name = await vscode.window.showInputBox({
      prompt: `New project folder inside ${parent[0].fsPath}`,
      value: defaultName,
      validateInput: (v) => {
        if (!v.trim() || /[\\/:*?"<>|]/.test(v)) return 'Use a folder name without / \\ : * ? " < > |';
        const target = path.join(parent[0].fsPath, v.trim());
        return fs.existsSync(target) && fs.readdirSync(target).length ? 'This folder exists and is not empty' : undefined;
      },
    });
    return name ? path.join(parent[0].fsPath, name.trim()) : undefined;
  }

  private async finish(data: Uint8Array, folder: string, template?: Template) {
    this.post({ type: 'busy', text: 'Extracting…' });
    const main = await extractProject(data, folder, template?.main);
    this.log.appendLine(`[templates] created ${folder} from ${template?.id ?? 'a ZIP file'}${main ? `, root ${main}` : ''}`);
    if (template?.requires.length) void this.checkRequirements(template.requires);

    await this.context.globalState.update(PENDING_KEY, { folder, main });
    const choice = await vscode.window.showInformationMessage(
      `Created ${path.basename(folder)}${main ? ` (root document ${main})` : ''}.`,
      'Open',
      'Open in New Window',
    );
    if (!choice) {
      await this.context.globalState.update(PENDING_KEY, undefined);
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: choice === 'Open in New Window' });
  }

  /** After the new folder opens (the extension restarts in that window), shows its root document. */
  private async openPending() {
    const pending = this.context.globalState.get<{ folder: string; main?: string }>(PENDING_KEY);
    if (!pending) return;
    const here = vscode.workspace.workspaceFolders?.some((f) => path.resolve(f.uri.fsPath) === path.resolve(pending.folder));
    if (!here) return;
    await this.context.globalState.update(PENDING_KEY, undefined);
    if (pending.main) await vscode.window.showTextDocument(vscode.Uri.file(path.join(pending.folder, pending.main)));
  }

  /** OL-56: names the classes or packages the TeX distribution does not have. Never installs anything. */
  private async checkRequirements(files: string[]) {
    const kpsewhich = config().get<Record<string, string>>('tools.paths')?.kpsewhich || 'kpsewhich';
    const missing: string[] = [];
    for (const file of files) {
      const found = await new Promise<boolean | undefined>((resolve) =>
        execFile(kpsewhich, [file], { timeout: 5000 }, (err, stdout) => resolve(err && (err as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : !!stdout.trim())),
      );
      if (found === undefined) return; // no kpsewhich: nothing reliable to report
      if (!found) missing.push(file);
    }
    if (!missing.length) return;
    void vscode.window.showWarningMessage(
      `Your TeX distribution does not have ${missing.join(', ')}. TeX Live: find the package with "tlmgr search --global --file ${missing[0]}" and install it with tlmgr; MiKTeX installs missing packages on the first build.`,
    );
  }
}
