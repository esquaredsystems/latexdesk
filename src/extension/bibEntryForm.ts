// Entry form editor (wireframe 1j): a panel beside a .bib file that shows the entry under the
// cursor as a form. Typing in the form makes minimal text edits; typing in the text updates the form.
import * as vscode from 'vscode';
import * as path from 'path';
import fieldsData from '../../data/bibFields.json';
import { BibEntry } from '../core/bibParser';
import { optionalFields, recommendedFields, requiredFields } from '../core/bibScanner';
import { changeType, insertFields, removeField, setField, TextEdit } from '../core/bibEdit';
import { BibHealth } from './bibFeatures';
import { BibManagerProvider } from './bibManager';
import { debounce, isBib, webviewHtml } from './util';

export class BibEntryForm implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private document?: vscode.TextDocument;
  private key?: string;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly health: BibHealth,
  ) {
    const follow = debounce((editor: vscode.TextEditor) => this.follow(editor), 150);
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.panel && isBib(e.textEditor.document) && follow(e.textEditor)),
      vscode.workspace.onDidChangeTextDocument((e) => e.document === this.document && e.contentChanges.length && this.schedulePost()),
    );
  }

  private schedulePost = debounce(() => this.post(), 150);

  dispose() {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  /** Opens the form beside the active .bib editor, or for a given entry key. */
  async show(document?: vscode.TextDocument, key?: string) {
    const editor = vscode.window.activeTextEditor;
    document ??= editor && isBib(editor.document) ? editor.document : await this.documentOfActiveBibManager();
    if (!document) {
      void vscode.window.showInformationMessage('Open a .bib file and place the cursor in an entry.');
      return;
    }
    this.document = document;
    const cursorEntry = editor?.document === document ? this.entryAt(document, editor.selection.active) : undefined;
    this.key = key ?? cursorEntry?.key ?? BibManagerProvider.selected.get(document.uri.toString()) ?? this.health.scan(path.normalize(document.fileName), document.getText()).file.entries[0]?.key;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('latexdesk.bibEntryForm', 'Entry', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
      this.panel.webview.html = webviewHtml(this.panel.webview, this.context.extensionUri, { title: 'Entry', script: 'dist/webview/bibEntryForm.js', styles: ['media/bibEntryForm.css'] });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
      this.panel.onDidDispose(() => (this.panel = undefined));
    } else {
      this.panel.reveal(undefined, true);
    }
    this.post();
  }

  /** When the Bib Manager tab is active there is no text editor; use the .bib file it shows. */
  private async documentOfActiveBibManager(): Promise<vscode.TextDocument | undefined> {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom && input.uri.fsPath.endsWith('.bib')) return vscode.workspace.openTextDocument(input.uri);
    return undefined;
  }

  private follow(editor: vscode.TextEditor) {
    const entry = this.entryAt(editor.document, editor.selection.active);
    if (!entry || (editor.document === this.document && entry.key === this.key)) return;
    this.document = editor.document;
    this.key = entry.key;
    this.post();
  }

  private entryAt(document: vscode.TextDocument, position: vscode.Position): BibEntry | undefined {
    const offset = document.offsetAt(position);
    const scan = this.health.scan(path.normalize(document.fileName), document.getText());
    return scan.file.entries.find((e) => e.start <= offset && offset <= e.end);
  }

  private current() {
    if (!this.document || !this.key) return undefined;
    const scan = this.health.scan(path.normalize(this.document.fileName), this.document.getText());
    const entry = scan.file.entries.find((e) => e.key === this.key);
    return entry && { scan, entry };
  }

  private post() {
    if (!this.panel) return;
    const found = this.current();
    if (!found) {
      void this.panel.webview.postMessage({ type: 'empty' });
      return;
    }
    const { scan, entry } = found;
    const dialect = this.health.dialect;
    const findings = scan.result.entries.get(entry)?.findings ?? [];
    // Attach each finding to the field whose value or name it points at.
    const problems: Record<string, { message: string; code: string; start: number; fixable: boolean }[]> = {};
    for (const f of findings) {
      const field = entry.fields.find((x) => f.start >= x.nameStart && f.start <= x.valueEnd);
      // "Missing field" findings point at the key; show them next to the (empty) field instead.
      const names = field ? [field.name] : f.fix?.kind === 'insertFields' ? f.fix.fields : ['_entry'];
      for (const name of names) (problems[name] ??= []).push({ message: f.message, code: f.code, start: f.start, fixable: !!f.fix });
    }
    const groups = {
      required: requiredFields(entry.type, dialect) ?? [],
      recommended: recommendedFields(entry.type, this.health.profile),
      optional: optionalFields(entry.type),
    };
    this.panel.title = `Entry: ${entry.key}`;
    void this.panel.webview.postMessage({
      type: 'entry',
      entry: { key: entry.key, type: entry.type, fields: entry.fields.map((f) => ({ name: f.name, value: f.value })) },
      types: Object.keys(fieldsData[dialect] as Record<string, string[]>),
      groups,
      problems,
      profile: this.health.profile,
      file: path.basename(this.document!.fileName),
    });
  }

  private async onMessage(msg: any) {
    if (msg.type === 'ready') return this.post();
    const found = this.current();
    if (!found || !this.document) return;
    const text = this.document.getText();
    const { entry } = found;
    let edit: TextEdit | undefined;
    switch (msg.type) {
      case 'set':
        edit = setField(text, entry, msg.field, msg.value);
        break;
      case 'add':
        if (!entry.fields.some((f) => f.name === msg.field)) edit = insertFields(text, entry, [[msg.field, '']]);
        break;
      case 'remove': {
        const field = entry.fields.find((f) => f.name === msg.field);
        if (field) edit = removeField(text, field);
        break;
      }
      case 'changeType':
        edit = changeType(text, entry, msg.value);
        break;
      case 'fix': {
        const finding = found.scan.result.findings.find((f) => f.entryKey === entry.key && f.code === msg.code && f.start === msg.start);
        edit = finding && this.health.fixEdit(found.scan, finding);
        break;
      }
      case 'openText': {
        const editor = await vscode.window.showTextDocument(this.document, { preserveFocus: false });
        const pos = this.document.positionAt(entry.start);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      }
    }
    if (!edit) return;
    const we = new vscode.WorkspaceEdit();
    we.replace(this.document.uri, new vscode.Range(this.document.positionAt(edit.start), this.document.positionAt(edit.end)), edit.text);
    await vscode.workspace.applyEdit(we);
  }
}
