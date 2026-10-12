// Bib Manager: a table view of a .bib file (wireframe 1h) with a health report (1k).
// It is a CustomTextEditor, so it edits the real document with minimal text edits:
// undo, save and the text editor all stay in sync.
import * as vscode from 'vscode';
import * as path from 'path';
import { describeEntry, BibEntry } from '../core/bibParser';
import { insertFields, removeField, setField, suppressEdit, TextEdit } from '../core/bibEdit';
import { BibHealth, SAFE_FIXES, ScannedBib } from './bibFeatures';
import { ProjectManager } from './projectManager';
import { debounce, webviewHtml } from './util';
import { Profile } from '../core/bibScanner';

export class BibManagerProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'latexstudio.bibManager';
  /** Entry selected in each open Bib Manager (by file URI), so "Edit Entry in Form" can follow it. */
  static readonly selected = new Map<string, string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectManager,
    private readonly health: BibHealth,
  ) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri, {
      title: 'Bib Manager',
      script: 'dist/webview/bibManager.js',
      styles: ['media/bibManager.css'],
    });

    const update = () => {
      const scan = this.health.scan(path.normalize(document.fileName), document.getText());
      void panel.webview.postMessage({ type: 'data', model: this.model(document, scan) });
    };
    const scheduleUpdate = debounce(update, 200);
    const subs = [
      vscode.workspace.onDidChangeTextDocument((e) => e.document === document && e.contentChanges.length && scheduleUpdate()),
      this.projects.onDidChange(scheduleUpdate),
      panel.webview.onDidReceiveMessage((msg) => this.onMessage(document, msg, update)),
    ];
    panel.onDidDispose(() => subs.forEach((s) => s.dispose()));
  }

  private model(document: vscode.TextDocument, scan: ScannedBib) {
    const cited = this.projects.citedKeys();
    const inProject = this.projects.project?.bibFiles.includes(path.normalize(document.fileName)) ?? false;
    const duplicateKeys = new Set(scan.result.duplicateGroups.flatMap((g) => g.keys));
    const rows = scan.file.entries.map((entry) => {
      const d = describeEntry(scan.file, entry);
      const report = scan.result.entries.get(entry);
      const findings = report?.findings ?? [];
      return {
        key: entry.key,
        type: entry.type,
        author: d.author,
        title: d.title,
        year: d.year,
        venue: d.venue,
        cited: inProject ? (cited.get(entry.key)?.length ?? 0) : null,
        citedIn: (cited.get(entry.key) ?? []).slice(0, 20).map((c) => ({ file: path.basename(c.file), path: c.file, line: c.line + 1 })),
        score: report?.score ?? 0,
        issues: findings.filter((f) => f.severity === 'error' || f.severity === 'warning').length,
        incomplete: findings.some((f) => f.code === 'bib/missing-required'),
        missingDoi: findings.some((f) => f.code === 'bib/missing-doi') || (entry.type === 'article' && !entry.fields.some((f) => f.name === 'doi')),
        duplicate: duplicateKeys.has(entry.key),
        possibleDuplicate: scan.result.duplicateGroups.some((g) => g.possible && g.keys.includes(entry.key)),
        findings: findings.map((f) => ({
          code: f.code,
          severity: f.severity,
          message: f.message,
          fixable: !!f.fix,
          safe: SAFE_FIXES.has(f.code),
          start: f.start,
          missing: f.fix?.kind === 'insertFields' ? f.fix.fields : undefined,
          replacement: f.fix?.kind === 'replace' ? f.fix.text : undefined,
        })),
        fields: entry.fields.map((f) => ({ name: f.name, value: f.value })),
        line: entry.line + 1,
      };
    });
    const byRule = new Map<string, number>();
    for (const f of scan.result.findings) byRule.set(f.code, (byRule.get(f.code) ?? 0) + 1);
    const allKeys = new Set(scan.file.entries.map((e) => e.key));
    const otherBibKeys = new Set(this.projects.bibEntries().map((e) => e.entry.key));
    const unresolved = inProject ? [...cited.keys()].filter((k) => !allKeys.has(k) && !otherBibKeys.has(k)) : [];
    const errors = scan.result.findings.filter((f) => f.severity === 'error').length;
    const warnings = scan.result.findings.filter((f) => f.severity === 'warning').length;
    const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 100;
    const profile = this.health.profile;
    const pass = errors === 0 && !rows.some((r) => r.incomplete) && unresolved.length === 0 && (profile !== 'strict' || warnings === 0);
    return {
      file: path.basename(document.fileName),
      dialect: this.health.dialect,
      profile,
      inProject,
      rows,
      summary: {
        total: rows.length,
        average,
        errors,
        warnings,
        verdict: pass ? 'PASS' : 'FAIL',
        unresolved,
        byRule: [...byRule].sort((a, b) => b[1] - a[1]),
        duplicateGroups: scan.result.duplicateGroups,
        syntax: scan.file.issues.length,
      },
    };
  }

  private async onMessage(document: vscode.TextDocument, msg: any, refresh: () => void) {
    const scan = this.health.scan(path.normalize(document.fileName), document.getText());
    const entryOf = (key: string) => scan.file.entries.find((e) => e.key === key);
    const apply = async (edits: TextEdit[], confirm = false, label = 'Bib Manager edit') => {
      if (!edits.length) return;
      const edit = new vscode.WorkspaceEdit();
      for (const e of edits) {
        const range = new vscode.Range(document.positionAt(e.start), document.positionAt(e.end));
        edit.replace(document.uri, range, e.text, confirm ? { needsConfirmation: true, label } : undefined);
      }
      await vscode.workspace.applyEdit(edit);
    };

    switch (msg.type) {
      case 'ready':
        refresh();
        break;
      case 'editField': {
        const entry = entryOf(msg.key);
        if (entry) await apply([setField(document.getText(), entry, msg.field, msg.value)]);
        break;
      }
      case 'addField': {
        const entry = entryOf(msg.key);
        const name = await vscode.window.showInputBox({ prompt: `New field for ${msg.key}`, placeHolder: 'doi' });
        if (entry && name) await apply([insertFields(document.getText(), entry, [[name.trim().toLowerCase(), '']])]);
        break;
      }
      case 'removeField': {
        const entry = entryOf(msg.key);
        const field = entry?.fields.find((f) => f.name === msg.field);
        if (field) await apply([removeField(document.getText(), field)]);
        break;
      }
      case 'fix': {
        const finding = scan.result.findings.find((f) => f.entryKey === msg.key && f.code === msg.code && f.start === msg.start);
        const edit = finding && this.health.fixEdit(scan, finding);
        if (edit) await apply([edit]);
        break;
      }
      case 'suppress': {
        const entry = entryOf(msg.key);
        if (entry) await apply([suppressEdit(document.getText(), entry, msg.code)]);
        break;
      }
      case 'fixAllSafe': {
        const edits = scan.result.findings.filter((f) => SAFE_FIXES.has(f.code)).map((f) => this.health.fixEdit(scan, f)).filter((e): e is TextEdit => !!e);
        await apply(edits, edits.length > 1, 'Fix all safe problems');
        break;
      }
      case 'bulk':
        await this.bulk(document, msg, entryOf, apply);
        break;
      case 'openText': {
        const entry = entryOf(msg.key);
        const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        if (entry) {
          const pos = document.positionAt(entry.start);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
        }
        break;
      }
      case 'openLocation': {
        const doc = await vscode.workspace.openTextDocument(msg.path);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        const pos = new vscode.Position(msg.line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        break;
      }
      case 'select':
        BibManagerProvider.selected.set(document.uri.toString(), msg.key);
        break;
      case 'editInForm':
        await vscode.commands.executeCommand('latexstudio.openEntryForm', document.uri, msg.key);
        break;
      case 'copyKey':
        await vscode.env.clipboard.writeText(msg.key);
        break;
      case 'setProfile':
        await this.health.setProfile(msg.profile as Profile);
        refresh();
        break;
      case 'scan':
        this.health.scanAll();
        refresh();
        break;
      case 'export':
        await this.exportReport(document, msg.format, this.model(document, scan));
        break;
    }
  }

  private async bulk(
    document: vscode.TextDocument,
    msg: { keys: string[]; action: string },
    entryOf: (k: string) => BibEntry | undefined,
    apply: (edits: TextEdit[], confirm?: boolean, label?: string) => Promise<void>,
  ) {
    const entries = msg.keys.map(entryOf).filter((e): e is BibEntry => !!e);
    if (!entries.length) return;
    const text = document.getText();
    let edits: TextEdit[] = [];
    if (msg.action === 'setField') {
      const field = await vscode.window.showInputBox({ prompt: `Field to set on ${entries.length} entries` });
      if (!field) return;
      const value = await vscode.window.showInputBox({ prompt: `Value for "${field}"` });
      if (value === undefined) return;
      edits = entries.map((e) => setField(text, e, field.trim().toLowerCase(), value));
    } else if (msg.action === 'removeField') {
      const names = [...new Set(entries.flatMap((e) => e.fields.map((f) => f.name)))].sort();
      const field = await vscode.window.showQuickPick(names, { placeHolder: `Field to remove from ${entries.length} entries` });
      if (!field) return;
      edits = entries.flatMap((e) => e.fields.filter((f) => f.name === field).map((f) => removeField(text, f)));
    } else if (msg.action === 'delete') {
      const ok = await vscode.window.showWarningMessage(`Delete ${entries.length} entr${entries.length > 1 ? 'ies' : 'y'} from ${path.basename(document.fileName)}?`, { modal: true }, 'Delete');
      if (ok !== 'Delete') return;
      edits = entries.map((e) => {
        let end = e.end;
        while (text[end] === '\r' || text[end] === '\n') end++;
        return { start: e.start, end, text: '' };
      });
    }
    // Changes touching more than one entry go through VS Code's refactor preview.
    await apply(edits, entries.length > 1, `Bib Manager: ${msg.action}`);
  }

  private async exportReport(document: vscode.TextDocument, format: 'md' | 'csv' | 'json', model: ReturnType<BibManagerProvider['model']>) {
    const base = path.basename(document.fileName, '.bib');
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(path.dirname(document.fileName), `${base}-health.${format}`)) });
    if (!target) return;
    let content = '';
    if (format === 'json') {
      content = JSON.stringify({ file: model.file, profile: model.profile, dialect: model.dialect, summary: model.summary, entries: model.rows.map(({ key, type, score, findings }) => ({ key, type, score, findings })) }, null, 2);
    } else if (format === 'csv') {
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      content = 'key,type,score,code,severity,message\n' + model.rows.flatMap((r) => (r.findings.length ? r.findings : [{ code: '', severity: '', message: '' }]).map((f) => [r.key, r.type, r.score, f.code, f.severity, f.message].map((v) => esc(String(v))).join(','))).join('\n');
    } else {
      const s = model.summary;
      content = `# Bibliography health: ${model.file}\n\nProfile: ${model.profile} · dialect: ${model.dialect} · ${s.total} entries · average score ${s.average}/100 · **${s.verdict}**\n\n`;
      content += `| Errors | Warnings | Unresolved citations | Duplicate groups |\n|---|---|---|---|\n| ${s.errors} | ${s.warnings} | ${s.unresolved.length} | ${s.duplicateGroups.length} |\n\n## Most common problems\n\n`;
      content += s.byRule.map(([code, n]) => `- \`${code}\`: ${n}`).join('\n');
      content += '\n\n## Least complete entries\n\n' + [...model.rows].sort((a, b) => a.score - b.score).slice(0, 15).map((r) => `- ${r.key} (${r.score})`).join('\n') + '\n';
      if (s.unresolved.length) content += `\n## Unresolved citations\n\n${s.unresolved.map((k) => `- ${k}`).join('\n')}\n`;
    }
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    void vscode.window.showInformationMessage(`Report saved to ${vscode.workspace.asRelativePath(target)}`);
  }
}
