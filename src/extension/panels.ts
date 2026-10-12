// Webview panels: project dashboard (1d), log viewer with explanations (1g) and tool setup (1v).
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BuildManager } from './buildManager';
import { ProjectManager } from './projectManager';
import { BibHealth } from './bibFeatures';
import { ToolRegistry } from './toolRegistry';
import { config, debounce, webviewHtml } from './util';
import { explain, Rule } from '../core/explain';
import { countWords } from '../core/wordCount';
import { HistoryStore } from '../build/history';

type Kind = 'dashboard' | 'log' | 'tools';
const TITLES: Record<Kind, string> = { dashboard: 'Project Dashboard', log: 'LaTeX Log', tools: 'Set up LaTeX Studio' };

export class Panels implements vscode.Disposable {
  private panels = new Map<Kind, vscode.WebviewPanel>();
  private disposables: vscode.Disposable[] = [];
  private focusMessage?: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectManager,
    private readonly builds: BuildManager,
    private readonly health: BibHealth,
    private readonly tools: ToolRegistry,
    private readonly activation: { activatedInMs: number },
  ) {
    const refresh = debounce(() => {
      for (const kind of this.panels.keys()) void this.post(kind);
    }, 300);
    this.disposables.push(builds.onDidChangeState(refresh), projects.onDidChange(refresh), health.onDidChange(refresh));
  }

  dispose() {
    for (const p of this.panels.values()) p.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  show(kind: Kind, options: { focusMessage?: string } = {}) {
    this.focusMessage = options.focusMessage;
    let panel = this.panels.get(kind);
    if (panel) {
      panel.reveal();
      void this.post(kind);
      return;
    }
    panel = vscode.window.createWebviewPanel(`latexstudio.${kind}`, TITLES[kind], vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri, { title: TITLES[kind], script: 'dist/webview/panels.js', styles: ['media/panels.css'] });
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(kind, msg));
    panel.onDidDispose(() => this.panels.delete(kind));
    this.panels.set(kind, panel);
  }

  private async post(kind: Kind) {
    const panel = this.panels.get(kind);
    if (!panel) return;
    const data = kind === 'dashboard' ? this.dashboard() : kind === 'log' ? this.log() : await this.toolsData();
    void panel.webview.postMessage({ kind, data });
  }

  private async onMessage(kind: Kind, msg: any) {
    switch (msg.type) {
      case 'ready':
        await this.post(kind);
        break;
      case 'command':
        await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
        break;
      case 'open': {
        const doc = await vscode.workspace.openTextDocument(msg.file);
        const line = Math.max(0, (msg.line ?? 1) - 1);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(line, 0, line, 0), viewColumn: vscode.ViewColumn.One });
        break;
      }
      case 'redetect':
        await this.tools.list(true);
        await this.post('tools');
        break;
      case 'install':
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case 'setPath':
        void vscode.commands.executeCommand('workbench.action.openSettings', 'latexstudio.tools.paths');
        break;
      case 'copyReport':
        await vscode.env.clipboard.writeText(await this.troubleshootingReport());
        void vscode.window.showInformationMessage('Troubleshooting report copied to the clipboard.');
        break;
    }
  }

  private dashboard() {
    const project = this.projects.project;
    const s = this.builds.state;
    const out = this.projects.output();
    const cited = this.projects.citedKeys();
    const known = new Set(this.projects.bibEntries().map((e) => e.entry.key));
    const unresolved = this.projects.bibs.size ? [...cited.keys()].filter((k) => !known.has(k)) : [];
    let scoreSum = 0;
    let entries = 0;
    let incomplete = 0;
    let missingDoi = 0;
    for (const bib of this.projects.bibs.values()) {
      const scan = this.health.get(bib.path);
      for (const report of scan?.result.entries.values() ?? []) {
        scoreSum += report.score;
        entries++;
        if (report.findings.some((f) => f.code === 'bib/missing-required')) incomplete++;
        if (report.findings.some((f) => f.code === 'bib/missing-doi')) missingDoi++;
      }
    }
    let words = 0;
    let todos = 0;
    const todoByFile = new Map<string, number>();
    let equations = 0;
    let sections = 0;
    for (const f of project?.files ?? []) {
      try {
        const text = vscode.workspace.textDocuments.find((d) => d.fileName === f.path)?.getText() ?? fs.readFileSync(f.path, 'utf8');
        words += countWords(text, { documentOnly: f.path === project?.root });
      } catch {
        // unreadable file: counted as zero words
      }
      todos += f.index.todos.length;
      if (f.index.todos.length) todoByFile.set(path.basename(f.path), f.index.todos.length);
      equations += f.index.environments.filter((e) => /^(equation|align|gather|multline)\*?$/.test(e.name)).length;
      sections += f.index.sections.length;
    }
    let pages: number | undefined;
    try {
      const m = out && /Output written on .* \((\d+) pages?/.exec(fs.readFileSync(path.join(out.outDir, out.jobName + '.log'), 'utf8'));
      pages = m ? Number(m[1]) : undefined;
    } catch {
      pages = undefined;
    }
    const blockers: { text: string; severity: string; action?: { label: string; command: string } }[] = [];
    if (s.errors) blockers.push({ text: `${s.errors} build error${s.errors > 1 ? 's' : ''}`, severity: 'error', action: { label: 'Open log', command: 'latexstudio.openLogViewer' } });
    if (unresolved.length) blockers.push({ text: `${unresolved.length} citation${unresolved.length > 1 ? 's' : ''} with no entry`, severity: 'error', action: { label: 'Show', command: 'latexstudio.citations.focus' } });
    if (incomplete) blockers.push({ text: `${incomplete} bibliography entr${incomplete > 1 ? 'ies' : 'y'} missing required fields`, severity: 'warning', action: { label: 'Bib Manager', command: 'latexstudio.openBibManager' } });
    if (missingDoi && this.health.profile !== 'minimal') blockers.push({ text: `${missingDoi} entr${missingDoi === 1 ? 'y' : 'ies'} missing a DOI (profile: ${this.health.profile})`, severity: 'warning', action: { label: 'Bib Manager', command: 'latexstudio.openBibManager' } });
    if (project && project.unresolved.length) blockers.push({ text: `${project.unresolved.length} unresolved include/bibliography/graphic reference${project.unresolved.length > 1 ? 's' : ''}`, severity: 'warning', action: { label: 'Files', command: 'latexstudio.files.focus' } });
    const topTodo = [...todoByFile].sort((a, b) => b[1] - a[1])[0];
    return {
      root: project ? `${path.basename(project.rootDir)} / ${path.basename(project.root)}` : undefined,
      ready: blockers.filter((b) => b.severity === 'error').length === 0 && s.phase === 'succeeded',
      blockers,
      build: { phase: s.phase, durationMs: s.durationMs, recipe: s.recipe, finishedAt: s.finishedAt },
      issues: { errors: s.errors, warnings: s.warnings, badBoxes: s.badBoxes },
      bib: { score: entries ? Math.round(scoreSum / entries) : undefined, entries, profile: this.health.profile },
      words,
      pages,
      sections,
      equations,
      todos,
      topTodo: topTodo ? `${topTodo[1]} in ${topTodo[0]}` : undefined,
      lastSnapshot: project ? new HistoryStore(project.rootDir).list().pop() : undefined,
    };
  }

  private log() {
    const root = this.projects.root;
    const rootDir = root ? path.dirname(root) : '';
    const out = this.projects.output();
    return {
      rawLog: out ? path.join(out.outDir, out.jobName + '.log') : undefined,
      focus: this.focusMessage,
      entries: this.builds.entries.map((e) => {
        const file = e.file ? path.resolve(rootDir, e.file) : root;
        const x = explain(e.message, config().get<Rule[]>('errors.extra') ?? []);
        return {
          ...e,
          file,
          fileLabel: file ? path.relative(rootDir, file) || path.basename(file) : '(no file)',
          explanation: x,
        };
      }),
    };
  }

  private async toolsData() {
    const list = await this.tools.list();
    return {
      trusted: vscode.workspace.isTrusted,
      platform: process.platform,
      tools: list,
      hasEngine: list.some((t) => (t.name === 'pdflatex' || t.name === 'latexmk' || t.name === 'tectonic') && t.path),
    };
  }

  async troubleshootingReport(): Promise<string> {
    const tools = await this.tools.list();
    const ext = vscode.extensions.getExtension('latexstudio.latexstudio');
    return [
      `LaTeX Studio ${ext?.packageJSON.version ?? ''} on VS Code ${vscode.version} (${process.platform} ${process.arch}, Node ${process.version})`,
      `Activation: ${this.activation.activatedInMs} ms`,
      `Root: ${this.projects.root ?? 'none'}; files: ${this.projects.project?.files.length ?? 0}; bib files: ${this.projects.bibs.size}`,
      `Recipe: ${this.builds.state.recipe ?? config().get('build.recipe')}; last build: ${this.builds.state.phase} ${this.builds.state.durationMs ?? ''} ms`,
      'Tools:',
      ...tools.map((t) => `  ${t.name}: ${t.path ? `${t.path} (${t.version ?? '?'})` : 'missing'}`),
    ].join('\n');
  }
}
