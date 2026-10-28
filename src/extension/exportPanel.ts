// Export for submission panel (wireframe 1u). The plan is recomputed whenever an option changes,
// so the checks and the file list always match what will be written.
import * as vscode from 'vscode';
import * as path from 'path';
import { ExportOptions, ExportPlan, planExport, Preset, PRESETS, verifyExport, writeExport } from '../build/exporter';
import { ProjectManager } from './projectManager';
import { config, webviewHtml } from './util';

export class ExportPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private preset: Preset = 'arxiv';
  private options: ExportOptions = { ...PRESETS.arxiv };
  private verify = true;
  private lastResult?: { ok: boolean; message: string; target?: string; dir?: string };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectManager,
  ) {}

  dispose() {
    this.panel?.dispose();
  }

  async show() {
    await this.projects.refresh();
    if (!this.projects.project) {
      void vscode.window.showWarningMessage('LaTeX Desk: no root document found.');
      return;
    }
    if (this.panel) {
      this.panel.reveal();
      this.post();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('latexdesk.export', 'Export for submission', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    this.panel.webview.html = webviewHtml(this.panel.webview, this.context.extensionUri, { title: 'Export', script: 'dist/webview/exportPanel.js', styles: ['media/export.css'] });
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.panel.onDidDispose(() => (this.panel = undefined));
  }

  private plan(): ExportPlan | undefined {
    const project = this.projects.project;
    const out = this.projects.output();
    return project && out ? planExport(project, out.outDir, out.jobName, this.options, this.preset) : undefined;
  }

  private post(busy?: string) {
    const plan = this.plan();
    if (!this.panel || !plan) return;
    void this.panel.webview.postMessage({
      preset: this.preset,
      options: this.options,
      verify: this.verify,
      files: plan.files.map((f) => ({ target: f.target, size: f.size, changed: f.content !== undefined })),
      totalBytes: plan.totalBytes,
      checks: plan.checks,
      notes: plan.notes,
      result: this.lastResult,
      busy,
    });
  }

  private async onMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        this.post();
        break;
      case 'preset':
        this.preset = msg.preset;
        if (msg.preset !== 'custom') this.options = { ...PRESETS[msg.preset as Exclude<Preset, 'custom'>] };
        this.lastResult = undefined;
        this.post();
        break;
      case 'option':
        this.options = { ...this.options, [msg.name]: msg.value };
        this.preset = 'custom';
        this.lastResult = undefined;
        this.post();
        break;
      case 'verify':
        this.verify = msg.value;
        this.post();
        break;
      case 'export':
        await this.export(msg.format);
        break;
      case 'reveal':
        if (msg.path) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        break;
    }
  }

  private async export(format: 'zip' | 'folder') {
    const plan = this.plan();
    const root = this.projects.root;
    const out = this.projects.output();
    if (!plan || !root || !out) return;
    const rootDir = path.dirname(root);
    const base = `${out.jobName}-${this.preset === 'custom' ? 'submission' : this.preset === 'project' ? 'source' : this.preset}`;
    let target: string | undefined;
    if (format === 'zip') {
      target = (await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(rootDir, base + '.zip')), filters: { 'ZIP archive': ['zip'] } }))?.fsPath;
    } else {
      const parent = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(path.dirname(rootDir)), openLabel: 'Export into this folder' });
      if (parent?.[0]) target = path.join(parent[0].fsPath, base);
    }
    if (!target) return;
    try {
      await writeExport(plan, target, format);
    } catch (err) {
      void vscode.window.showErrorMessage(`Export failed: ${(err as Error).message}`);
      return;
    }
    this.lastResult = { ok: true, message: `Exported ${plan.files.length} files.`, target };
    if (this.verify && vscode.workspace.isTrusted) {
      this.post('Compiling the exported copy in a temporary folder…');
      const rootTarget = path.relative(rootDir, root).split(path.sep).join('/');
      const verified = await verifyExport(plan, rootTarget, out.jobName, config().get<Record<string, string>>('tools.paths') ?? {});
      this.lastResult = { ok: verified.ok, message: `Exported ${plan.files.length} files. ${verified.message}`, target, dir: verified.dir || undefined };
    }
    this.post();
  }
}
