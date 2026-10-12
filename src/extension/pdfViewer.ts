// Opens PDFs in webview panels (one per PDF file) and keeps them in sync with builds.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BuildManager } from './buildManager';
import { ProjectManager } from './projectManager';
import { config, samePath, webviewHtml } from './util';

export class PdfViewerManager implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>();
  private disposables: vscode.Disposable[] = [];
  /** Called when the user Ctrl/Cmd-clicks in the PDF. */
  onReverseSync?: (pdf: string, page: number, x: number, y: number) => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly builds: BuildManager,
    private readonly projects: ProjectManager,
  ) {
    this.disposables.push(
      builds.onDidProducePdf((pdf) => {
        if (this.panels.has(pdf)) void this.load(pdf);
        else if (config().get('viewer.openAfterBuild') && !this.context.workspaceState.get(`latexstudio.viewerOpened:${pdf}`)) {
          void this.context.workspaceState.update(`latexstudio.viewerOpened:${pdf}`, true);
          void this.open(pdf);
        }
      }),
      builds.onDidChangeState(() => this.broadcastBuildState()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('latexstudio.viewer')) for (const p of this.panels.values()) this.postSettings(p);
      }),
      // Restore viewers after a window reload.
      vscode.window.registerWebviewPanelSerializer('latexstudio.pdf', {
        deserializeWebviewPanel: async (panel, state: { pdf?: string }) => {
          if (state?.pdf && fs.existsSync(state.pdf)) this.attach(panel, state.pdf);
          else panel.dispose();
        },
      }),
    );
  }

  dispose() {
    for (const p of this.panels.values()) p.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  has(pdf: string) {
    return this.panels.has(pdf);
  }

  async open(pdf: string, column?: vscode.ViewColumn) {
    // Default layout: source on the left, PDF beside it.
    column ??= vscode.window.activeTextEditor?.viewColumn ? vscode.window.activeTextEditor.viewColumn + 1 : vscode.ViewColumn.Two;
    const existing = this.panels.get(pdf);
    if (existing) {
      existing.reveal(existing.viewColumn ?? column, true);
      return existing;
    }
    // retainContextWhenHidden keeps the document and its rendered pages alive while the tab is hidden.
    const panel = vscode.window.createWebviewPanel('latexstudio.pdf', path.basename(pdf), { viewColumn: column, preserveFocus: true }, { retainContextWhenHidden: true });
    this.attach(panel, pdf);
    return panel;
  }

  private attach(panel: vscode.WebviewPanel, pdf: string) {
    const ext = this.context.extensionUri;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(ext, 'dist'), vscode.Uri.joinPath(ext, 'media')],
    };
    panel.iconPath = vscode.Uri.joinPath(ext, 'media', 'icon.svg');
    const worker = panel.webview.asWebviewUri(vscode.Uri.joinPath(ext, 'dist', 'webview', 'pdf.worker.min.mjs'));
    panel.webview.html = webviewHtml(panel.webview, ext, {
      title: path.basename(pdf),
      script: 'dist/webview/pdfViewer.js',
      styles: ['dist/webview/pdf_viewer.css', 'media/pdfViewer.css'],
      body: `<meta name="pdf-worker" content="${worker}">`,
      workers: true,
    });
    this.panels.set(pdf, panel);

    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(pdf, panel, msg));
    panel.onDidDispose(() => this.panels.delete(pdf));
  }

  private async handleMessage(pdf: string, panel: vscode.WebviewPanel, msg: { type: string; page: number; x: number; y: number }) {
    switch (msg.type) {
      case 'ready':
        this.postSettings(panel);
        // The webview stores the path so the serializer can reopen it after a reload.
        void panel.webview.postMessage({ type: 'remember', pdf });
        this.postBuildState(panel);
        await this.load(pdf);
        break;
      case 'reverseSync':
        this.onReverseSync?.(pdf, msg.page, msg.x, msg.y);
        break;
      case 'build':
        void vscode.commands.executeCommand('latexstudio.build');
        break;
      case 'rebuild':
        void vscode.commands.executeCommand('latexstudio.rebuild');
        break;
      case 'stop':
        void vscode.commands.executeCommand('latexstudio.stopBuild');
        break;
      case 'toggleFastPreview':
        void vscode.commands.executeCommand('latexstudio.toggleFastPreview');
        break;
      case 'buildPartial':
        void vscode.commands.executeCommand('latexstudio.buildPartial');
        break;
      case 'buildFull':
        void this.builds.build({ mode: 'full' });
        break;
      case 'toggleAutoBuild':
        void vscode.commands.executeCommand('latexstudio.toggleAutoBuild');
        break;
      case 'openLog':
        void vscode.commands.executeCommand('latexstudio.openLogViewer');
        break;
      case 'openExternal':
        void vscode.env.openExternal(vscode.Uri.file(pdf));
        break;
      case 'chooseRoot':
        void vscode.commands.executeCommand('latexstudio.selectRoot');
        break;
      case 'showProblems':
        void vscode.commands.executeCommand('workbench.actions.view.problems');
        break;
    }
  }

  /** The file currently shown for `pdf`: the full build's PDF or a fast/partial preview. */
  shownFile(pdf: string): string {
    return this.builds.displayed(pdf).file;
  }

  /** Sends the PDF bytes to the viewer. Missing files show the "No PDF yet" state instead. */
  async load(pdf: string) {
    const panel = this.panels.get(pdf);
    if (!panel) return;
    const source = this.builds.displayed(pdf);
    let data: Uint8Array;
    try {
      const buffer = await fs.promises.readFile(source.file);
      // A plain Uint8Array is transferred to the webview efficiently; a Node Buffer is not.
      data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      const root = this.projects.root;
      void panel.webview.postMessage({
        type: 'noPdf',
        name: path.basename(pdf),
        root: root ? path.basename(root) : 'none',
        recipe: this.builds.state.recipe ?? config().get('build.recipe'),
      });
      return;
    }
    void panel.webview.postMessage({ type: 'load', data, mode: source.mode, label: source.label });
  }

  post(pdf: string, msg: unknown) {
    const panel = this.panels.get(pdf) ?? [...this.panels.entries()].find(([p]) => samePath(p, pdf))?.[1];
    if (panel) void panel.webview.postMessage(msg);
  }

  private postSettings(panel: vscode.WebviewPanel) {
    void panel.webview.postMessage({
      type: 'settings',
      settings: { theme: config().get('viewer.theme'), reverseClick: config().get('viewer.reverseSyncClick') },
    });
  }

  private postBuildState(panel: vscode.WebviewPanel) {
    void panel.webview.postMessage({
      type: 'build',
      state: this.builds.state,
      autoBuild: config().get('build.autoBuild') === 'onSave',
      fastPreview: this.builds.fastPreview,
    });
  }

  private broadcastBuildState() {
    for (const p of this.panels.values()) this.postBuildState(p);
  }
}
