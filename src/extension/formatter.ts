// Format Document: built-in formatter, or latexindent / tex-fmt when configured.
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { formatLatex } from '../core/formatter';
import { config } from './util';

function runFormatter(command: string, args: string[], input: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new Error(`${command} could not be started: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} exited with ${code}: ${err.slice(0, 300)}`))));
    child.stdin.end(input);
  });
}

export function registerFormatter(context: vscode.ExtensionContext) {
  const provider: vscode.DocumentFormattingEditProvider & vscode.DocumentRangeFormattingEditProvider = {
    async provideDocumentFormattingEdits(doc, options) {
      const text = doc.getText();
      const formatted = await format(doc, text, options);
      if (formatted === undefined || formatted === text) return [];
      return [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), formatted)];
    },
    async provideDocumentRangeFormattingEdits(doc, range, options) {
      // Only the selected lines are changed.
      const full = new vscode.Range(range.start.line, 0, range.end.line, doc.lineAt(range.end.line).text.length);
      const text = doc.getText(full);
      const formatted = await format(doc, text, options);
      if (formatted === undefined || formatted === text) return [];
      return [vscode.TextEdit.replace(full, formatted)];
    },
  };

  async function format(doc: vscode.TextDocument, text: string, options: vscode.FormattingOptions): Promise<string | undefined> {
    const tool = config(doc.uri).get<string>('format.tool') ?? 'builtin';
    const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    if (tool === 'builtin') return formatLatex(text, { indent });
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('LaTeX Studio: external formatters are disabled in Restricted Mode; using the built-in formatter.');
      return formatLatex(text, { indent });
    }
    const paths = config().get<Record<string, string>>('tools.paths') ?? {};
    const cwd = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? path.dirname(doc.fileName);
    try {
      if (tool === 'latexindent') return await runFormatter(paths.latexindent || 'latexindent', ['-'], text, cwd);
      return await runFormatter(paths['tex-fmt'] || 'tex-fmt', ['--stdin'], text, cwd);
    } catch (err) {
      void vscode.window.showErrorMessage(`LaTeX Studio: ${(err as Error).message}`);
      return undefined;
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider([{ language: 'latex' }], provider),
    vscode.languages.registerDocumentRangeFormattingEditProvider([{ language: 'latex' }], provider),
  );
}
