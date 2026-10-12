// Commands behind the editor's top toolbar and the left mini bar.
// The buttons themselves are declared in package.json (top bar) and in the Tools view (mini bar).
import * as vscode from 'vscode';
import * as path from 'path';
import { alignLines, changeSize, Replacement, toggleCommand } from '../core/formatting';
import { tableEdit, TableOp } from '../core/table';
import { ProjectManager } from './projectManager';
import { isTex } from './util';

/** Text commands of the formatting buttons, and the package each needs (if any). */
export const STYLES: Record<string, { command: string; pkg?: string; options?: string }> = {
  bold: { command: 'textbf' },
  italic: { command: 'textit' },
  underline: { command: 'underline' },
  strikeout: { command: 'sout', pkg: 'ulem', options: 'normalem' },
  highlight: { command: 'hl', pkg: 'soul' },
};

export const ALIGNMENTS: Record<string, { env: string; pkg?: string }> = {
  left: { env: 'flushleft' },
  center: { env: 'center' },
  right: { env: 'flushright' },
  justify: { env: 'justify', pkg: 'ragged2e' },
};

const SECTIONS = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const REFERENCES = ['label', 'ref', 'eqref', 'pageref', 'cref', 'cite'];

export class EditorToolbar {
  /** The LaTeX editor the buttons act on; kept when focus moves to the Tools view. */
  private lastEditor?: vscode.TextEditor;

  constructor(private readonly projects: ProjectManager) {}

  register(context: vscode.ExtensionContext) {
    const command = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    this.lastEditor = vscode.window.activeTextEditor && isTex(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor : undefined;
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e && isTex(e.document)) this.lastEditor = e;
      }),
    );

    // Top bar: editing and build. The editor keeps focus, so the built-in commands act on it.
    const builtIn: Record<string, string> = {
      undo: 'undo',
      redo: 'redo',
      cut: 'editor.action.clipboardCutAction',
      copy: 'editor.action.clipboardCopyAction',
      paste: 'editor.action.clipboardPasteAction',
      comment: 'editor.action.commentLine',
    };
    for (const [name, target] of Object.entries(builtIn)) {
      command(`latexstudio.tb.${name}`, async () => {
        await this.focusEditor();
        await vscode.commands.executeCommand(target);
      });
    }
    command('latexstudio.tb.compile', () => vscode.commands.executeCommand('latexstudio.build'));
    command('latexstudio.tb.buildView', async () => {
      await vscode.commands.executeCommand('latexstudio.build');
      await vscode.commands.executeCommand('latexstudio.viewPdf');
    });
    command('latexstudio.tb.log', () => vscode.commands.executeCommand('latexstudio.openLogViewer'));

    for (const name of SECTIONS) command(`latexstudio.insert.${name}`, () => this.insertSection(name));
    for (const name of REFERENCES) command(`latexstudio.insert.${name}`, () => this.insertReference(name));
    for (const op of ['addRow', 'deleteRow', 'addColumn', 'deleteColumn'] as TableOp[]) command(`latexstudio.table.${op}`, () => this.table(op));

    // Formatting (top bar and mini bar).
    for (const name of Object.keys(STYLES)) command(`latexstudio.format.${name}`, () => this.style(name));
    for (const name of Object.keys(ALIGNMENTS)) command(`latexstudio.format.align.${name}`, () => this.align(name));
    command('latexstudio.format.larger', () => this.size(1));
    command('latexstudio.format.smaller', () => this.size(-1));
  }

  /** The LaTeX editor to act on, or undefined (with a hint) when none is open. */
  editor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && isTex(active.document)) return active;
    const visible = vscode.window.visibleTextEditors.find((e) => e === this.lastEditor) ?? vscode.window.visibleTextEditors.find((e) => isTex(e.document));
    if (!visible) void vscode.window.showInformationMessage('Open a LaTeX file first.');
    return visible;
  }

  /**
   * Gives the keyboard focus to the editor. A click in the mini bar leaves the editor "active" but
   * moves the focus to the side bar, so this is done every time, not only when the editor changed.
   */
  async focusEditor(editor = this.editor()) {
    if (editor) await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
    return editor;
  }

  /** Applies one replacement per selection and selects the affected text afterwards. */
  private async replaceSelections(make: (text: string, start: number, end: number) => Replacement) {
    const editor = await this.focusEditor();
    if (!editor) return;
    const doc = editor.document;
    const text = doc.getText();
    const replacements = editor.selections.map((s) => {
      let start = doc.offsetAt(s.start);
      let end = doc.offsetAt(s.end);
      // With nothing selected, act on the word under the cursor.
      if (start === end) {
        const word = doc.getWordRangeAtPosition(s.active, /[\p{L}\p{N}'-]+/u);
        if (word) [start, end] = [doc.offsetAt(word.start), doc.offsetAt(word.end)];
      }
      return make(text, start, end);
    });
    const ok = await editor.edit((e) => replacements.forEach((r) => e.replace(new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end)), r.text)));
    if (!ok) return;
    // Later replacements shift the positions of earlier ones; recompute from the new text.
    let shift = 0;
    editor.selections = [...replacements]
      .sort((a, b) => a.start - b.start)
      .map((r) => {
        const sel = new vscode.Selection(doc.positionAt(r.selectStart + shift), doc.positionAt(r.selectEnd + shift));
        shift += r.text.length - (r.end - r.start);
        return sel;
      });
  }

  private async style(name: string) {
    const { command, pkg, options } = STYLES[name];
    const editor = this.editor();
    // Empty selection and no word under the cursor: insert an empty command to type into.
    if (editor && editor.selections.every((s) => s.isEmpty && !editor.document.getWordRangeAtPosition(s.active, /[\p{L}\p{N}'-]+/u))) {
      await this.focusEditor(editor);
      await editor.insertSnippet(new vscode.SnippetString(`\\${command}{$1}$0`));
    } else {
      await this.replaceSelections((text, start, end) => toggleCommand(text, start, end, command));
    }
    if (pkg) await this.offerPackage(pkg, options);
  }

  private async size(step: 1 | -1) {
    await this.replaceSelections((text, start, end) => changeSize(text, start, end, step));
  }

  private async align(name: string) {
    const editor = await this.focusEditor();
    if (!editor) return;
    const doc = editor.document;
    const sel = editor.selection;
    // Whole lines; a selection ending at column 0 does not include that line.
    const lastLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
    const start = doc.offsetAt(new vscode.Position(sel.start.line, 0));
    const end = doc.offsetAt(doc.lineAt(lastLine).range.end);
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const r = alignLines(doc.getText(), start, end, ALIGNMENTS[name].env, eol);
    await editor.edit((e) => e.replace(new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end)), r.text));
    editor.selection = new vscode.Selection(doc.positionAt(r.selectStart), doc.positionAt(r.selectEnd));
    if (ALIGNMENTS[name].pkg) await this.offerPackage(ALIGNMENTS[name].pkg!);
  }

  private async insertSection(name: string) {
    const editor = await this.focusEditor();
    if (!editor) return;
    const selected = editor.document.getText(editor.selection);
    const body = selected ? selected.replace(/[$}\\]/g, '\\$&') : '$1';
    await editor.insertSnippet(new vscode.SnippetString(`\\${name}{${body}}$0`));
  }

  private async insertReference(name: string) {
    const editor = await this.focusEditor();
    if (!editor) return;
    await editor.insertSnippet(new vscode.SnippetString(`\\${name}{$1}$0`));
    // Labels and keys come from the project: open the completion list right away.
    if (name !== 'label') await vscode.commands.executeCommand('editor.action.triggerSuggest');
  }

  private async table(op: TableOp) {
    const editor = await this.focusEditor();
    if (!editor) return;
    const doc = editor.document;
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edits = tableEdit(doc.getText(), doc.offsetAt(editor.selection.active), op, eol);
    if ('error' in edits) {
      void vscode.window.showInformationMessage(`LaTeX Studio: ${edits.error}`);
      return;
    }
    await editor.edit((e) => edits.forEach((x) => e.replace(new vscode.Range(doc.positionAt(x.start), doc.positionAt(x.end)), x.text)));
  }

  /** Offers to add \usepackage for a command or environment the document does not load yet. */
  async offerPackage(pkg: string, options?: string) {
    if (!this.projects.root || this.projects.packages().includes(pkg)) return;
    const line = `\\usepackage${options ? `[${options}]` : ''}{${pkg}}`;
    const add = await vscode.window.showInformationMessage(`This needs the ${pkg} package, which ${path.basename(this.projects.root)} does not load.`, `Add ${line}`);
    if (add) await addPackageLine(this.projects.root, line);
  }
}

/** Adds a \usepackage line after the last one in the root document (or before \begin{document}). */
export async function addPackageLine(root: string, line: string) {
  const doc = await vscode.workspace.openTextDocument(root);
  const text = doc.getText();
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const lastUse = [...text.matchAll(/^\\usepackage.*$/gm)].pop();
  const at = lastUse ? lastUse.index! + lastUse[0].length : text.indexOf('\\begin{document}');
  if (at < 0) return;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, doc.positionAt(at), lastUse ? eol + line : line + eol);
  await vscode.workspace.applyEdit(edit);
  void vscode.window.setStatusBarMessage(`LaTeX Studio: added ${line} to ${path.basename(root)}`, 4000);
}
