// The left mini bar ("LaTeX Tools" view): formatting, alignment, text size, equations and
// symbols. Buttons act on the last active LaTeX editor.
import * as vscode from 'vscode';
import symbols from '../../data/symbols.json';
import { EditorToolbar } from './toolbar';
import { config, isTex, webviewHtml } from './util';

/** Equation buttons. ${TM_SELECTED_TEXT} puts selected text inside, e.g. selecting x then $x$. */
const EQUATIONS: Record<string, string> = {
  inline: '\\$${1:${TM_SELECTED_TEXT}}\\$$0',
  display: '\\\\[\n\t${1:${TM_SELECTED_TEXT}}\n\\\\]$0',
  equation: '\\begin{equation}\n\t${1:${TM_SELECTED_TEXT}}\n\t\\label{eq:$2}\n\\end{equation}$0',
  align: '\\begin{align}\n\t${1:${TM_SELECTED_TEXT}} &= $2\n\\end{align}$0',
  frac: '\\frac{${1:${TM_SELECTED_TEXT}}}{$2}$0',
  sqrt: '\\sqrt{${1:${TM_SELECTED_TEXT}}}$0',
  sup: '^{${1:${TM_SELECTED_TEXT}}}$0',
  sub: '_{${1:${TM_SELECTED_TEXT}}}$0',
  sum: '\\sum_{${1:i=1}}^{${2:n}} $0',
  int: '\\int_{${1:a}}^{${2:b}} $0',
  lim: '\\lim_{${1:x \\to \\infty}} $0',
  paren: '\\left( ${1:${TM_SELECTED_TEXT}} \\right)$0',
  text: '\\text{${1:${TM_SELECTED_TEXT}}}$0',
  cases: '\\begin{cases}\n\t${1:a} & \\text{if } ${2:x > 0} \\\\\\\\\n\t${3:b} & \\text{otherwise}\n\\end{cases}$0',
};

export class ToolsView implements vscode.WebviewViewProvider {
  static readonly viewId = 'latexdesk.tools';
  private recent: string[];
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly toolbar: EditorToolbar,
  ) {
    this.recent = context.globalState.get<string[]>('latexdesk.recentSymbols') ?? [];
  }

  register() {
    let shown = false;
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ToolsView.viewId, this),
      // Open the mini bar next to the first LaTeX file of the session, then give the focus back.
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (!shown && e && isTex(e.document) && config().get<boolean>('toolbar.showMiniBar')) {
          shown = true;
          void this.reveal();
        }
      }),
    );
    const active = vscode.window.activeTextEditor;
    if (active && isTex(active.document) && config().get<boolean>('toolbar.showMiniBar')) {
      shown = true;
      void this.reveal();
    }
  }

  private async reveal() {
    await vscode.commands.executeCommand('workbench.view.extension.latexdesk-tools');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri, { title: 'LaTeX Tools', script: 'dist/webview/tools.js', styles: ['media/tools.css'] });
    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          void view.webview.postMessage({ symbols: symbols.symbols, recent: this.recent, iconBase: view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'toolbar')).toString() });
          break;
        case 'command':
          // Only the editor toolbar's own commands can be run from the view.
          if (/^latexdesk\.(format|tb|table|insert)\.[\w.]+$/.test(msg.id)) await vscode.commands.executeCommand(msg.id);
          break;
        case 'equation':
          if (EQUATIONS[msg.name]) await this.snippet(EQUATIONS[msg.name]);
          break;
        case 'matrix':
          await this.matrix(msg.rows, msg.cols, msg.kind);
          break;
        case 'symbol':
          await this.symbol(msg.command, msg.pkg);
          break;
      }
    });
  }

  private async snippet(body: string) {
    const editor = await this.toolbar.focusEditor();
    if (editor) await editor.insertSnippet(new vscode.SnippetString(body));
  }

  private async matrix(rows: number, cols: number, kind: string) {
    let n = 1;
    const body = Array.from({ length: rows }, () => Array.from({ length: cols }, () => `\${${n++}}`).join(' & ')).join(' \\\\\\\\\n\t');
    await this.snippet(`\\begin{${kind}}\n\t${body}\n\\end{${kind}}$0`);
  }

  private async symbol(command: string, pkg: string) {
    const editor = await this.toolbar.focusEditor();
    if (!editor) return;
    await editor.edit((e) => editor.selections.forEach((s) => e.replace(s, command)));
    this.recent = [command, ...this.recent.filter((c) => c !== command)].slice(0, 16);
    void this.context.globalState.update('latexdesk.recentSymbols', this.recent);
    void this.view?.webview.postMessage({ recent: this.recent });
    if (pkg) await this.toolbar.offerPackage(pkg);
  }
}
