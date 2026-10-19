import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function config(scope?: vscode.Uri) {
  return vscode.workspace.getConfiguration('latexdesk', scope);
}

export function isTex(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'latex' || doc.languageId === 'tex' || /\.(tex|ltx)$/i.test(doc.fileName);
}

export function isBib(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'bibtex' || /\.bib$/i.test(doc.fileName);
}

/** Text of a file: the open editor's (possibly unsaved) text when there is one, otherwise the disk content. */
export async function readText(file: string): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && samePath(d.fileName, file));
  if (open) return open.getText();
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

export async function exists(file: string): Promise<boolean> {
  if (vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'file' && samePath(d.fileName, file))) return true;
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

export function samePath(a: string, b: string): boolean {
  const na = path.normalize(a);
  const nb = path.normalize(b);
  return process.platform === 'linux' ? na === nb : na.toLowerCase() === nb.toLowerCase();
}

/** Debounces calls per key. */
export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  return (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** Standard HTML shell for our webviews with a strict Content Security Policy. */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: { script: string; styles?: string[]; title: string; body?: string; workers?: boolean },
): string {
  const n = nonce();
  const uri = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, p));
  const styles = ['media/studio.css', ...(options.styles ?? [])].map((s) => `<link rel="stylesheet" href="${uri(s)}">`).join('\n');
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${n}' ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
    options.workers ? `worker-src blob:` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${options.title}</title>
${styles}
</head>
<body>
${options.body ?? '<div id="app"></div>'}
<script nonce="${n}" type="module" src="${uri(options.script)}"></script>
</body>
</html>`;
}

export function relative(from: string, file: string): string {
  return path.relative(from, file) || path.basename(file);
}
