// "New LaTeX Project" quick start: a few questions, then a folder with a compiling skeleton.
// Existing files are never overwritten.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function newProject() {
  const cls = await vscode.window.showQuickPick(['article', 'report', 'book', 'beamer'], { placeHolder: '1/5 Document class' });
  if (!cls) return;
  const engine = await vscode.window.showQuickPick(['pdflatex', 'xelatex', 'lualatex'], { placeHolder: '2/5 Engine' });
  if (!engine) return;
  const bib = await vscode.window.showQuickPick(['BibTeX (natbib)', 'BibLaTeX + Biber', 'No bibliography'], { placeHolder: '3/5 Bibliography' });
  if (!bib) return;
  const layout = cls === 'beamer' ? 'Single file' : await vscode.window.showQuickPick(['Single file', 'Chapters with \\include'], { placeHolder: '4/5 Layout' });
  if (!layout) return;
  const title = await vscode.window.showInputBox({ prompt: '5/5 Title', value: 'Untitled' });
  if (title === undefined) return;
  const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Create project here' });
  if (!folder?.[0]) return;
  const dir = folder[0].fsPath;

  const unit = cls === 'article' ? 'section' : 'chapter';
  const packages = [
    engine === 'pdflatex' ? '\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}' : '\\usepackage{fontspec}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    bib.startsWith('BibTeX') ? '\\usepackage[numbers]{natbib}' : bib.startsWith('BibLaTeX') ? '\\usepackage[backend=biber]{biblatex}\n\\addbibresource{references.bib}' : '',
    '\\usepackage{hyperref}',
  ].filter(Boolean);
  const bibEnd = bib.startsWith('BibTeX') ? '\\bibliographystyle{plainnat}\n\\bibliography{references}\n' : bib.startsWith('BibLaTeX') ? '\\printbibliography\n' : '';
  const files: Record<string, string> = {};
  let body: string;
  if (cls === 'beamer') {
    body = `\\begin{frame}{${title}}\n  First slide.\n\\end{frame}\n`;
  } else if (layout === 'Single file') {
    body = `\\maketitle\n\n\\${unit}{Introduction}\\label{sec:intro}\nStart writing here.${bib === 'No bibliography' ? '' : ' See~\\cite{example2024}.'}\n`;
  } else {
    body = `\\maketitle\n\\tableofcontents\n\n\\include{chapters/introduction}\n`;
    files['chapters/introduction.tex'] = `\\${unit}{Introduction}\\label{ch:intro}\nStart writing here.${bib === 'No bibliography' ? '' : ' See~\\cite{example2024}.'}\n`;
  }
  files['main.tex'] = `% !TEX program = ${engine}\n\\documentclass{${cls}}\n${packages.join('\n')}\n\n\\title{${title}}\n\\author{}\n\n\\begin{document}\n${body}\n${bibEnd}\\end{document}\n`;
  if (bib !== 'No bibliography') {
    files['references.bib'] = `@book{example2024,\n  author    = {Doe, Jane},\n  title     = {An Example Book},\n  publisher = {Example Press},\n  year      = {2024},\n}\n`;
  }

  const skipped: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    if (fs.existsSync(target)) {
      skipped.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  if (skipped.length) void vscode.window.showWarningMessage(`Kept existing files: ${skipped.join(', ')}`);
  const doc = await vscode.workspace.openTextDocument(path.join(dir, 'main.tex'));
  await vscode.window.showTextDocument(doc);
}
