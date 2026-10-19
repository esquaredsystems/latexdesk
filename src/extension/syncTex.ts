// Forward (source -> PDF) and reverse (PDF -> source) navigation using the in-process reader.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { SyncTexData } from '../core/synctex';
import { PdfViewerManager } from './pdfViewer';
import { ProjectManager } from './projectManager';

const gunzipAsync = promisify(gunzip);

export class SyncTexService implements vscode.Disposable {
  private cache = new Map<string, { mtime: number; data: SyncTexData }>();
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    isWholeLine: true,
  });

  constructor(
    private readonly projects: ProjectManager,
    private readonly viewer: PdfViewerManager,
    private readonly log: vscode.OutputChannel,
  ) {
    viewer.onReverseSync = (pdf, page, x, y) => void this.reverse(pdf, page, x, y);
  }

  dispose() {
    this.highlight.dispose();
  }

  /** Loads (and caches until the next build) the SyncTeX data that belongs to a PDF. */
  async load(pdf: string): Promise<SyncTexData | undefined> {
    const base = pdf.replace(/\.pdf$/i, '');
    for (const file of [base + '.synctex.gz', base + '.synctex']) {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        continue;
      }
      const cached = this.cache.get(file);
      if (cached && cached.mtime === stat.mtimeMs) return cached.data;
      const t0 = Date.now();
      const raw = await fs.promises.readFile(file);
      const text = file.endsWith('.gz') ? (await gunzipAsync(raw)).toString('utf8') : raw.toString('utf8');
      const data = SyncTexData.parse(text);
      // Some engines write input paths relative to the build directory.
      data.resolveInputs((p) => (path.isAbsolute(p) ? p : path.resolve(path.dirname(pdf), p)));
      this.cache.set(file, { mtime: stat.mtimeMs, data });
      this.log.appendLine(`[synctex] indexed ${path.basename(file)} in ${Date.now() - t0} ms`);
      return data;
    }
    return undefined;
  }

  async forward(editor = vscode.window.activeTextEditor) {
    if (!editor) return;
    await this.projects.refresh();
    const out = this.projects.output();
    if (!out) return;
    if (!this.viewer.has(out.pdf)) await this.viewer.open(out.pdf);
    const data = await this.load(this.viewer.shownFile(out.pdf));
    const line = editor.selection.active.line + 1;
    if (!data) {
      this.viewer.post(out.pdf, { type: 'syncUnavailable', message: 'No SyncTeX file found next to the PDF. Build with SyncTeX enabled (the default recipes do).' });
      return;
    }
    const t0 = Date.now();
    const result = data.forward(editor.document.fileName, line);
    this.log.appendLine(`[synctex] forward ${path.basename(editor.document.fileName)}:${line} -> ${result ? `page ${result.page}` : 'no match'} (${Date.now() - t0} ms)`);
    if (!result) {
      const stale = editor.document.isDirty || (await this.isStale(this.viewer.shownFile(out.pdf), editor.document.fileName));
      this.viewer.post(out.pdf, {
        type: 'syncUnavailable',
        message: stale ? `No mapping for line ${line} — SyncTeX data is older than the source.` : `No mapping for line ${line} of ${path.basename(editor.document.fileName)}.`,
      });
      return;
    }
    // The viewer keeps the request until its PDF has loaded.
    this.viewer.post(out.pdf, { type: 'sync', page: result.page, box: result.box });
  }

  private async reverse(pdf: string, page: number, x: number, y: number) {
    const data = await this.load(this.viewer.shownFile(pdf));
    if (!data) {
      void vscode.window.showWarningMessage('LaTeX Desk: no SyncTeX data for this PDF. Rebuild to enable source navigation.');
      return;
    }
    const t0 = Date.now();
    const result = data.reverse(page, x, y);
    this.log.appendLine(`[synctex] reverse page ${page} (${x.toFixed(0)}, ${y.toFixed(0)}) -> ${result ? `${path.basename(result.file)}:${result.line}` : 'no match'} (${Date.now() - t0} ms)`);
    if (!result) return;
    if (!fs.existsSync(result.file)) {
      void vscode.window.showWarningMessage(`LaTeX Desk: SyncTeX points to ${result.file}, which does not exist.`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(result.file);
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: this.sourceColumn(), preserveFocus: false });
    const line = Math.min(Math.max(result.line - 1, 0), doc.lineCount - 1);
    const pos = new vscode.Position(line, doc.lineAt(line).firstNonWhitespaceCharacterIndex);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.setDecorations(this.highlight, [new vscode.Range(line, 0, line, 0)]);
    setTimeout(() => editor.setDecorations(this.highlight, []), 1500);
  }

  private sourceColumn(): vscode.ViewColumn {
    const textEditor = vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'file');
    return textEditor?.viewColumn ?? vscode.ViewColumn.One;
  }

  private async isStale(pdf: string, source: string): Promise<boolean> {
    try {
      const [p, s] = await Promise.all([fs.promises.stat(pdf), fs.promises.stat(source)]);
      return s.mtimeMs > p.mtimeMs;
    } catch {
      return true;
    }
  }
}
