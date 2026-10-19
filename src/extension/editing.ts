// Editing commands: environments, wrapping, display math and list-aware Enter.
import * as vscode from 'vscode';
import latexData from '../../data/latex.json';
import { parseTex } from '../core/texParser';
import { innermostOpenEnvironment } from './languageFeatures';

const ENV_NAMES = (latexData.environments as [string, string, string][]).map((e) => e[0]);

async function pickEnvironment(placeHolder: string): Promise<string | undefined> {
  const items = ENV_NAMES.map((name) => ({ label: name }));
  const pick = vscode.window.createQuickPick();
  pick.items = items;
  pick.placeholder = placeHolder;
  return new Promise((resolve) => {
    // Allow names that are not in the list.
    pick.onDidChangeValue((v) => (pick.items = v && !ENV_NAMES.includes(v) ? [{ label: v, description: 'custom' }, ...items] : items));
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.label ?? pick.value);
      pick.hide();
    });
    pick.onDidHide(() => resolve(undefined));
    pick.show();
  });
}

export function registerEditingCommands(context: vscode.ExtensionContext) {
  const reg = (id: string, fn: (editor: vscode.TextEditor) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) return fn(editor);
      }),
    );

  reg('latexdesk.insertEnvironment', async (editor) => {
    const name = await pickEnvironment('Environment to insert');
    if (!name) return;
    await editor.insertSnippet(new vscode.SnippetString(`\\begin{${name}}\n\t$0\n\\end{${name}}`));
  });

  reg('latexdesk.wrapEnvironment', async (editor) => {
    const name = await pickEnvironment('Wrap the selection in…');
    if (!name) return;
    await editor.edit((edit) => {
      for (const sel of editor.selections) {
        const indent = editor.document.lineAt(sel.start.line).text.match(/^\s*/)?.[0] ?? '';
        const text = editor.document.getText(sel);
        edit.replace(sel, `\\begin{${name}}\n${indent}\t${text.replace(/\n/g, '\n\t')}\n${indent}\\end{${name}}`);
      }
    });
  });

  reg('latexdesk.wrapCommand', async (editor) => {
    const commands = ['textbf', 'textit', 'emph', 'underline', 'texttt', 'textsc', 'mathbf', 'mathrm', 'boldsymbol', 'text', 'footnote', 'url'];
    const name = await vscode.window.showQuickPick(commands, { placeHolder: 'Wrap the selection in a command' });
    if (!name) return;
    await editor.edit((edit) => {
      for (const sel of editor.selections) edit.replace(sel, `\\${name}{${editor.document.getText(sel)}}`);
    });
  });

  reg('latexdesk.closeEnvironment', async (editor) => {
    const index = parseTex(editor.document.getText());
    const name = innermostOpenEnvironment(index, editor.document.offsetAt(editor.selection.active));
    const open = index.environments.find((e) => e.name === name && e.endOffset === undefined);
    if (!name || !open) {
      void vscode.window.showInformationMessage('No open environment at the cursor.');
      return;
    }
    await editor.insertSnippet(new vscode.SnippetString(`\\end{${name}}`));
  });

  reg('latexdesk.renameEnvironment', async (editor) => {
    const doc = editor.document;
    const index = parseTex(doc.getText());
    const offset = doc.offsetAt(editor.selection.active);
    const env = index.environments
      .filter((e) => e.endOffset !== undefined && e.beginOffset <= offset && e.endOffset >= offset)
      .sort((a, b) => b.beginOffset - a.beginOffset)[0];
    if (!env || env.endOffset === undefined) {
      void vscode.window.showInformationMessage('The cursor is not inside a closed environment.');
      return;
    }
    const newName = await vscode.window.showInputBox({ prompt: `Rename environment "${env.name}"`, value: env.name });
    if (!newName || newName === env.name) return;
    const beginName = doc.positionAt(env.beginOffset + '\\begin{'.length);
    const endName = doc.positionAt(env.endOffset + '\\end{'.length);
    await editor.edit((edit) => {
      edit.replace(new vscode.Range(beginName, beginName.translate(0, env.name.length)), newName);
      edit.replace(new vscode.Range(endName, endName.translate(0, env.name.length)), newName);
    });
  });

  reg('latexdesk.toggleDisplayMath', async (editor) => {
    const doc = editor.document;
    const text = doc.getText();
    const offset = doc.offsetAt(editor.selection.active);
    const find = (re: RegExp) => {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) if (offset >= m.index && offset <= m.index + m[0].length) return m;
      return undefined;
    };
    const bracket = find(/\\\[([\s\S]*?)\\\]/g);
    if (bracket) {
      const range = new vscode.Range(doc.positionAt(bracket.index), doc.positionAt(bracket.index + bracket[0].length));
      await editor.edit((e) => e.replace(range, `\\begin{equation}${bracket[1]}\\end{equation}`));
      return;
    }
    const env = find(/\\begin\{equation(\*?)\}([\s\S]*?)\\end\{equation\1\}/g);
    if (env) {
      if (/\\label\{/.test(env[2])) {
        void vscode.window.showWarningMessage('This equation has a \\label; \\[...\\] is unnumbered, so the label would break. Remove the label first.');
        return;
      }
      const range = new vscode.Range(doc.positionAt(env.index), doc.positionAt(env.index + env[0].length));
      await editor.edit((e) => e.replace(range, `\\[${env[2]}\\]`));
      return;
    }
    void vscode.window.showInformationMessage('Place the cursor inside \\[...\\] or an equation environment.');
  });

  // Enter on an \item line continues the list; Enter on an empty \item ends it.
  reg('latexdesk.onEnter', async (editor) => {
    const sel = editor.selection;
    const line = editor.document.lineAt(sel.active.line);
    const m = /^(\s*)\\item\b(\[[^\]]*\])?\s*(.*)$/.exec(line.text);
    const atEnd = sel.active.character >= line.text.trimEnd().length;
    if (!m || !sel.isEmpty || !atEnd) {
      return vscode.commands.executeCommand('type', { source: 'keyboard', text: '\n' });
    }
    const index = parseTex(editor.document.getText());
    const env = innermostOpenEnvironment(index, editor.document.offsetAt(sel.active));
    if (!env || !['itemize', 'enumerate', 'description'].includes(env)) {
      return vscode.commands.executeCommand('type', { source: 'keyboard', text: '\n' });
    }
    if (!m[3] && !m[2]) {
      // Empty item: remove it instead of piling up empty items.
      await editor.edit((e) => e.replace(line.range, m[1]));
      return;
    }
    await editor.edit((e) => e.insert(sel.active, `\n${m[1]}\\item `));
  });
}
