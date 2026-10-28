// One-click sharing commands: the source ZIP for publishers (OL-48) and a watermarked copy of
// the PDF (OL-49).
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { planExport, PRESETS, verifyExport, writeExport } from '../build/exporter';
import type { Placement } from '../build/watermark';
import { ProjectManager } from './projectManager';
import { config, samePath } from './util';

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function registerSharing(context: vscode.ExtensionContext, projects: ProjectManager) {
  context.subscriptions.push(
    vscode.commands.registerCommand('latexdesk.exportSourceZip', () => createSourceZip(projects)),
    vscode.commands.registerCommand('latexdesk.exportWatermarkedPdf', () => exportWatermarkedPdf(context, projects)),
  );
}

async function createSourceZip(projects: ProjectManager) {
  await projects.refresh();
  const project = projects.project;
  const out = projects.output();
  if (!project || !out) {
    void vscode.window.showWarningMessage('LaTeX Desk: no root document found.');
    return;
  }
  const plan = planExport(project, out.outDir, out.jobName, { ...PRESETS.project }, 'project');
  const target = (
    await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(project.rootDir, `${out.jobName}-source.zip`)),
      filters: { 'ZIP archive': ['zip'] },
      saveLabel: 'Create Source ZIP',
    })
  )?.fsPath;
  if (!target) return;
  try {
    await writeExport(plan, target, 'zip');
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not write the ZIP: ${(err as Error).message}`);
    return;
  }

  const summary = `Source ZIP: ${plan.files.length} files, ${size(fs.statSync(target).size)}. ${plan.notes.join(' ')}`;
  const actions = vscode.workspace.isTrusted ? ['Reveal', 'Verify'] : ['Reveal'];
  const choice = await vscode.window.showInformationMessage(summary, ...actions);
  if (choice === 'Reveal') await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
  if (choice !== 'Verify') return;

  const rootTarget = path.relative(project.rootDir, project.root).split(path.sep).join('/');
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Compiling the ZIP contents in a temporary folder…' }, () =>
    verifyExport(plan, rootTarget, out.jobName, config().get<Record<string, string>>('tools.paths') ?? {}),
  );
  if (result.ok) void vscode.window.showInformationMessage(`Source ZIP verified. ${result.message}`);
  else if ((await vscode.window.showErrorMessage(`Source ZIP: ${result.message}`, 'Open build folder')) === 'Open build folder') {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.dir));
  }
}

async function exportWatermarkedPdf(context: vscode.ExtensionContext, projects: ProjectManager) {
  await projects.refresh();
  const out = projects.output();
  if (!out || !fs.existsSync(out.pdf)) {
    void vscode.window.showWarningMessage('LaTeX Desk: build the document first; the watermark is added to a copy of the built PDF.');
    return;
  }
  const text = await vscode.window.showInputBox({
    prompt: 'Watermark text, printed on every page of a copy of the PDF',
    value: context.globalState.get<string>('latexdesk.watermark.text') ?? 'DRAFT',
    validateInput: (v) => (v.trim() ? undefined : 'Enter the text to print'),
  });
  if (!text) return;
  const placements: (vscode.QuickPickItem & { value: Placement })[] = [
    { label: 'Diagonal across the page', value: 'diagonal' },
    { label: 'Top margin', value: 'top' },
    { label: 'Bottom margin', value: 'bottom' },
  ];
  const placement = await vscode.window.showQuickPick(placements, { placeHolder: 'Where should the watermark go?' });
  if (!placement) return;
  const target = (
    await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(out.outDir, `${out.jobName}-watermarked.pdf`)),
      filters: { PDF: ['pdf'] },
      saveLabel: 'Save watermarked PDF',
    })
  )?.fsPath;
  if (!target) return;
  if (samePath(target, out.pdf)) {
    void vscode.window.showErrorMessage('Choose another file name: the built PDF is never overwritten.');
    return;
  }

  // pdf-lib lives in its own bundle so that it is only loaded here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the path is only known at runtime
  const { watermarkPdf, UnsupportedTextError } = require(vscode.Uri.joinPath(context.extensionUri, 'dist', 'watermark.js').fsPath) as typeof import('../build/watermark');
  try {
    const bytes = await watermarkPdf(fs.readFileSync(out.pdf), { text, placement: placement.value, opacity: config().get<number>('watermark.opacity') ?? 0.15 });
    fs.writeFileSync(target, bytes);
  } catch (err) {
    const hint = err instanceof UnsupportedTextError ? ' For other scripts, use a LaTeX package such as draftwatermark in the preamble.' : '';
    void vscode.window.showErrorMessage(`Could not add the watermark: ${(err as Error).message}${hint}`);
    return;
  }
  await context.globalState.update('latexdesk.watermark.text', text);
  const choice = await vscode.window.showInformationMessage(`Saved ${path.basename(target)}.`, 'Open', 'Reveal');
  if (choice === 'Open') await vscode.env.openExternal(vscode.Uri.file(target));
  if (choice === 'Reveal') await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
}
