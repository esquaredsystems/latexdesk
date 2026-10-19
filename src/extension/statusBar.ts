// Status bar (wireframe 1a): root · build state · recipe · issue counts on the left, word count on the right.
import * as vscode from 'vscode';
import * as path from 'path';
import { BuildManager } from './buildManager';
import { ProjectManager } from './projectManager';
import { config, isBib, isTex } from './util';

export class StatusBar implements vscode.Disposable {
  private root = vscode.window.createStatusBarItem('latexdesk.root', vscode.StatusBarAlignment.Left, 50);
  private build = vscode.window.createStatusBarItem('latexdesk.buildState', vscode.StatusBarAlignment.Left, 49);
  private recipe = vscode.window.createStatusBarItem('latexdesk.recipe', vscode.StatusBarAlignment.Left, 48);
  private issues = vscode.window.createStatusBarItem('latexdesk.issues', vscode.StatusBarAlignment.Left, 47);
  private fast = vscode.window.createStatusBarItem('latexdesk.fast', vscode.StatusBarAlignment.Left, 46);
  private words = vscode.window.createStatusBarItem('latexdesk.words', vscode.StatusBarAlignment.Right, 100);
  private timer?: NodeJS.Timeout;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly projects: ProjectManager, private readonly builds: BuildManager, private readonly context: vscode.ExtensionContext) {
    this.root.name = 'LaTeX Desk: root document';
    this.root.command = 'latexdesk.selectRoot';
    this.build.name = 'LaTeX Desk: build';
    this.build.command = 'latexdesk.compileMenu';
    this.recipe.name = 'LaTeX Desk: recipe';
    this.recipe.command = 'latexdesk.selectRecipe';
    this.issues.name = 'LaTeX Desk: issues';
    this.issues.command = 'workbench.actions.view.problems';
    this.fast.name = 'LaTeX Desk: fast preview';
    this.fast.command = 'latexdesk.toggleFastPreview';
    this.words.name = 'LaTeX Desk: word count';
    this.words.command = 'latexdesk.wordCount';
    this.words.tooltip = 'Approximate word count of the project (click for details)';

    this.disposables.push(
      projects.onDidChange(() => this.update()),
      builds.onDidChangeState(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('latexdesk') && this.update()),
    );
    this.update();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    [this.root, this.build, this.recipe, this.issues, this.fast, this.words].forEach((i) => i.dispose());
    this.disposables.forEach((d) => d.dispose());
  }

  setWordCount(words: number | undefined) {
    if (words === undefined) this.words.hide();
    else {
      this.words.text = `${words.toLocaleString()} words ≈`;
      this.words.show();
    }
  }

  private update() {
    const editor = vscode.window.activeTextEditor;
    const relevant = !!this.projects.root && (!editor || isTex(editor.document) || isBib(editor.document) || editor.document.uri.scheme !== 'file');
    const items = [this.root, this.build, this.recipe, this.issues, this.fast];
    if (!relevant) {
      items.forEach((i) => i.hide());
      this.words.hide();
      return;
    }
    const s = this.builds.state;
    this.root.text = `§ ${path.basename(this.projects.root!)}`;
    this.root.tooltip = `Root document: ${this.projects.root}\nClick to choose another root`;

    if (this.timer) clearInterval(this.timer);
    if (s.phase === 'building') {
      const tick = () => {
        const secs = Math.floor((Date.now() - (s.startedAt ?? Date.now())) / 1000);
        this.build.text = `$(sync~spin) ${s.step ?? 'Building'} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      };
      tick();
      this.timer = setInterval(tick, 1000);
      this.build.backgroundColor = undefined;
    } else if (s.phase === 'succeeded') {
      this.build.text = `$(check) Built ${((s.durationMs ?? 0) / 1000).toFixed(1)} s`;
      this.build.backgroundColor = undefined;
    } else if (s.phase === 'failed') {
      this.build.text = `$(error) Build failed`;
      this.build.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (s.phase === 'cancelled') {
      this.build.text = `$(debug-stop) Stopped`;
      this.build.backgroundColor = undefined;
    } else {
      this.build.text = `$(play) Build`;
      this.build.backgroundColor = undefined;
    }
    this.build.tooltip = s.message ?? 'Compile options';

    const recipe = s.recipe ?? this.context.workspaceState.get<string>('latexdesk.recipe') ?? config().get<string>('build.recipe') ?? '';
    this.recipe.text = recipe.replace(/^latexmk \((\w+)\)$/, 'latexmk · $1');
    this.recipe.tooltip = `Recipe: ${recipe} (click to change)`;

    this.issues.text = `$(error) ${s.errors} $(warning) ${s.warnings}`;
    this.issues.tooltip = `${s.errors} errors, ${s.warnings} warnings, ${s.badBoxes} bad boxes in the last build`;
    this.fast.text = `Fast: ${this.builds.fastPreview ? 'on' : 'off'}`;
    this.fast.tooltip = this.builds.fastPreview
      ? 'Builds produce a fast preview with draft images (not for submission). Click to turn off.'
      : 'Click to make builds produce a fast preview with draft images.';
    items.forEach((i) => i.show());
    if (s.phase === 'idle') this.issues.hide();
  }
}
