// Table wizard (wireframe 1p): a grid editor for tabular / tabularx / longtable. It opens on the
// table at the cursor (parsed back into the grid), on a blank grid, or on spreadsheet data from
// the clipboard or a CSV file, and writes the result back as one edit.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { emptyTable, generateTable, parseDelimited, parseTable, requiredPackages, TableModel, toCsv } from '../core/table';
import { ProjectManager } from './projectManager';
import { isTex, webviewHtml } from './util';

interface Target {
  uri: vscode.Uri;
  /** Range of the existing table, or an empty range at the cursor for a new one. */
  range: vscode.Range;
  version: number;
}

export class TableWizard implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private target?: Target;
  /** The model to send once a newly created webview reports that it is ready. */
  private pendingModel?: { model: TableModel; note: string };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectManager,
  ) {}

  dispose() {
    this.panel?.dispose();
  }

  register() {
    this.context.subscriptions.push(
      this,
      vscode.commands.registerCommand('latexstudio.tableWizard', () => this.open('cursor')),
      vscode.commands.registerCommand('latexstudio.pasteTable', () => this.open('clipboard')),
      vscode.commands.registerCommand('latexstudio.importCsv', () => this.open('csv')),
    );
  }

  private async open(source: 'cursor' | 'clipboard' | 'csv') {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTex(editor.document)) {
      void vscode.window.showInformationMessage('Open a .tex file and place the cursor where the table should go.');
      return;
    }
    const doc = editor.document;
    let model: TableModel = emptyTable();
    let range = new vscode.Range(editor.selection.active, editor.selection.active);
    let note = 'New table at the cursor';

    if (source === 'cursor') {
      const existing = tableAt(doc, editor.selection.active);
      if (existing) {
        const parsed = parseTable(doc.getText(existing));
        if ('error' in parsed) {
          void vscode.window.showWarningMessage(`LaTeX Studio: ${parsed.error}`);
          return;
        }
        model = parsed;
        range = existing;
        note = `Editing the table at ${path.basename(doc.fileName)}:${existing.start.line + 1}`;
      }
    } else {
      const text = source === 'clipboard' ? await vscode.env.clipboard.readText() : await this.readCsvFile();
      if (!text?.trim()) {
        if (source === 'clipboard') void vscode.window.showInformationMessage('The clipboard is empty. Copy cells from a spreadsheet first.');
        return;
      }
      const rows = parseDelimited(text);
      model = { ...emptyTable(), rows, columns: Array(rows[0]?.length ?? 1).fill('l') };
      note = `${rows.length} rows from ${source === 'clipboard' ? 'the clipboard' : 'a CSV file'}`;
    }
    this.target = { uri: doc.uri, range, version: doc.version };
    this.show(model, note);
  }

  private async readCsvFile(): Promise<string | undefined> {
    const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'CSV / TSV': ['csv', 'tsv', 'txt'] } });
    return pick?.[0] ? fs.readFileSync(pick[0].fsPath, 'utf8') : undefined;
  }

  private show(model: TableModel, note: string) {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('latexstudio.tableWizard', 'Table wizard', vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      });
      this.panel.webview.html = webviewHtml(this.panel.webview, this.context.extensionUri, { title: 'Table wizard', script: 'dist/webview/tableWizard.js', styles: ['media/tableWizard.css'] });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
      this.panel.onDidDispose(() => (this.panel = undefined));
      // The webview asks for the model when it is ready.
      this.pendingModel = { model, note };
    } else {
      this.panel.reveal();
      this.post(model, note);
    }
  }

  private post(model: TableModel, note: string) {
    const loaded = new Set(this.projects.packages());
    void this.panel?.webview.postMessage({ type: 'model', model, note, loadedPackages: [...loaded] });
  }

  private async onMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        if (this.pendingModel) this.post(this.pendingModel.model, this.pendingModel.note);
        this.pendingModel = undefined;
        break;
      case 'paste': {
        const rows = parseDelimited(await vscode.env.clipboard.readText());
        if (rows.length) void this.panel?.webview.postMessage({ type: 'rows', rows });
        break;
      }
      case 'importCsv': {
        const text = await this.readCsvFile();
        if (text) void this.panel?.webview.postMessage({ type: 'rows', rows: parseDelimited(text) });
        break;
      }
      case 'exportCsv': {
        const uri = await vscode.window.showSaveDialog({ filters: { CSV: ['csv'] } });
        if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(toCsv(msg.model.rows), 'utf8'));
        break;
      }
      case 'write':
        await this.write(msg.model);
        break;
    }
  }

  private async write(model: TableModel) {
    const target = this.target;
    if (!target) return;
    const doc = await vscode.workspace.openTextDocument(target.uri);
    if (doc.version !== target.version && !target.range.isEmpty) {
      const ok = await vscode.window.showWarningMessage('The document changed since the wizard opened. Replace the table anyway?', { modal: true }, 'Replace');
      if (ok !== 'Replace') return;
    }
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, target.range, generateTable(model, eol));

    // Offer to load packages the table needs; never add them silently.
    const loaded = new Set(this.projects.packages());
    const missing = requiredPackages(model).filter((p) => !loaded.has(p));
    if (missing.length && this.projects.root) {
      const add = `Add \\usepackage{${missing.join(',')}}`;
      const choice = await vscode.window.showInformationMessage(`This table needs ${missing.join(', ')}, which the document does not load.`, add, 'Insert without');
      if (!choice) return;
      if (choice === add) this.addPackages(edit, missing);
    }
    await vscode.workspace.applyEdit(edit);
    this.target = undefined;
    this.panel?.dispose();
  }

  /** Inserts \usepackage lines after the last \usepackage of the root document (or after \documentclass). */
  private addPackages(edit: vscode.WorkspaceEdit, packages: string[]) {
    const root = this.projects.root!;
    const index = this.projects.index(root);
    const text = vscode.workspace.textDocuments.find((d) => d.fileName === root)?.getText() ?? fs.readFileSync(root, 'utf8');
    const lines = text.split(/\r?\n/);
    const anchor = index?.packages.length ? index.packages[index.packages.length - 1].line : (index?.documentClass?.line ?? 0);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const at = new vscode.Position(anchor, lines[anchor]?.length ?? 0);
    edit.insert(vscode.Uri.file(root), at, packages.map((p) => `${eol}\\usepackage{${p}}`).join(''));
  }
}

/** Range of the table around `pos`: the enclosing table float if there is one, else the tabular. */
function tableAt(doc: vscode.TextDocument, pos: vscode.Position): vscode.Range | undefined {
  const text = doc.getText();
  const offset = doc.offsetAt(pos);
  const enclosing = (names: string) => {
    const re = new RegExp(`\\\\begin\\{(${names})\\}`, 'g');
    let best: [number, number] | undefined;
    for (const m of text.matchAll(re)) {
      if (m.index! > offset) break;
      const end = text.indexOf(`\\end{${m[1]}}`, m.index!);
      if (end >= 0 && end + m[1].length + 6 >= offset) best = [m.index!, end + `\\end{${m[1]}}`.length];
    }
    return best;
  };
  const span = enclosing('table\\*?') ?? enclosing('tabularx|tabular|longtable');
  if (!span) return undefined;
  // A table float without a tabular inside (e.g. only an image) is not ours to edit.
  if (!/\\begin\{(tabular|tabularx|longtable)\}/.test(text.slice(span[0], span[1]))) return undefined;
  return new vscode.Range(doc.positionAt(span[0]), doc.positionAt(span[1]));
}
