// Bibliography checks (diagnostics + quick fixes), .bib completion and the citation browser.
import * as vscode from 'vscode';
import * as path from 'path';
import fieldsData from '../../data/bibFields.json';
import { BibFile, BibEntry, describeEntry, parseBib } from '../core/bibParser';
import { BibFinding, detectDialect, Dialect, Profile, ScanResult, scanBib, requiredFields, Severity } from '../core/bibScanner';
import { insertFields, suppressEdit, TextEdit } from '../core/bibEdit';
import { ProjectManager } from './projectManager';
import { config, debounce, isBib } from './util';

/** Rules whose fixes are deterministic and safe to apply in bulk ("Fix all safe"). */
export const SAFE_FIXES = new Set(['bib/page-range', 'bib/doi-url', 'bib/et-al']);

export interface ScannedBib {
  path: string;
  text: string;
  file: BibFile;
  result: ScanResult;
}

export class BibHealth implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('latexdesk-bib');
  private scans = new Map<string, ScannedBib>();
  private findingsByDiagnostic = new WeakMap<vscode.Diagnostic, BibFinding>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly projects: ProjectManager) {
    const rescanAll = debounce(() => this.scanAll(), 300);
    const rescanDoc = debounce((doc: vscode.TextDocument) => this.scanDocument(doc), 250);
    this.disposables.push(
      this.collection,
      this.changed,
      projects.onDidChange(rescanAll),
      vscode.workspace.onDidOpenTextDocument((d) => isBib(d) && this.scanDocument(d)),
      vscode.workspace.onDidChangeTextDocument((e) => isBib(e.document) && e.contentChanges.length && rescanDoc(e.document)),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('latexdesk.bib') && rescanAll()),
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  get dialect(): Dialect {
    return detectDialect(this.projects.packages(), config().get('bib.dialect') ?? 'auto');
  }

  get profile(): Profile {
    return config().get<Profile>('bib.profile') ?? 'standard';
  }

  setProfile(profile: Profile) {
    return config().update('bib.profile', profile, vscode.ConfigurationTarget.Workspace);
  }

  scanAll() {
    for (const bib of this.projects.bibs.values()) this.scan(bib.path, bib.text);
    for (const doc of vscode.workspace.textDocuments) if (isBib(doc) && !this.projects.bibs.has(doc.fileName)) this.scanDocument(doc);
    this.changed.fire();
  }

  scanDocument(doc: vscode.TextDocument) {
    this.scan(path.normalize(doc.fileName), doc.getText());
    this.changed.fire();
  }

  get(file: string): ScannedBib | undefined {
    return this.scans.get(path.normalize(file));
  }

  /** Scans one bibliography and publishes its diagnostics. */
  scan(file: string, text: string): ScannedBib {
    const parsed = parseBib(text);
    const inProject = this.projects.project?.bibFiles.includes(file);
    const result = scanBib(parsed, text, {
      dialect: this.dialect,
      profile: this.profile,
      citedKeys: inProject ? new Set(this.projects.citedKeys().keys()) : undefined,
      uncitedSeverity: config().get<Severity | 'off'>('bib.uncited') ?? 'hint',
      overrides: config().get<Record<string, Severity | 'off'>>('bib.rules') ?? {},
    });
    const scanned = { path: file, text, file: parsed, result };
    this.scans.set(file, scanned);

    const lines = parsed.lines;
    const diags = result.findings.map((f) => {
      const s = lines.position(f.start);
      const e = lines.position(f.end);
      const d = new vscode.Diagnostic(new vscode.Range(s.line, s.character, e.line, e.character), f.message, toSeverity(f.severity));
      d.source = 'bib';
      d.code = f.code;
      if (f.code === 'bib/uncited') d.tags = [vscode.DiagnosticTag.Unnecessary];
      this.findingsByDiagnostic.set(d, f);
      return d;
    });
    this.collection.set(vscode.Uri.file(file), diags);
    return scanned;
  }

  entryScore(key: string): { score: number; issues: number; missingRequired?: string } | undefined {
    for (const scan of this.scans.values()) {
      for (const [entry, report] of scan.result.entries) {
        if (entry.key !== key) continue;
        const missing = report.findings.find((f) => f.code === 'bib/missing-required');
        return {
          score: report.score,
          issues: report.findings.filter((f) => f.severity === 'error' || f.severity === 'warning').length,
          missingRequired: missing?.fix?.kind === 'insertFields' ? missing.fix.fields.join(', ') : undefined,
        };
      }
    }
    return undefined;
  }

  findingFor(d: vscode.Diagnostic) {
    return this.findingsByDiagnostic.get(d);
  }

  /** Converts a finding's fix into a text edit (or undefined when it has none). */
  fixEdit(scan: ScannedBib, finding: BibFinding): TextEdit | undefined {
    if (!finding.fix) return undefined;
    if (finding.fix.kind === 'replace') return { start: finding.fix.start, end: finding.fix.end, text: finding.fix.text };
    const entry = scan.file.entries.find((e) => e.key === finding.entryKey);
    return entry ? insertFields(scan.text, entry, finding.fix.fields.map((f) => [f, ''])) : undefined;
  }

  register(context: vscode.ExtensionContext) {
    const selector: vscode.DocumentSelector = [{ language: 'bibtex' }];
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(selector, { provideCodeActions: (doc, _range, ctx) => this.codeActions(doc, ctx) }),
      vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems: (doc, pos) => this.completions(doc, pos) }, '@'),
      vscode.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols: (doc) => {
          const parsed = parseBib(doc.getText());
          return parsed.entries.map((e) => {
            const range = new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end));
            return new vscode.DocumentSymbol(e.key || '(no key)', `@${e.type}`, vscode.SymbolKind.Struct, range, new vscode.Range(doc.positionAt(e.keyStart), doc.positionAt(e.keyEnd)));
          });
        },
      }),
      vscode.languages.registerFoldingRangeProvider(selector, {
        provideFoldingRanges: (doc) =>
          parseBib(doc.getText()).entries.map((e) => new vscode.FoldingRange(doc.positionAt(e.start).line, doc.positionAt(Math.max(e.start, e.end - 1)).line)),
      }),
    );
  }

  private codeActions(doc: vscode.TextDocument, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const scan = this.get(doc.fileName);
    if (!scan || scan.text !== doc.getText()) return [];
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      const finding = this.findingFor(d);
      if (!finding) continue;
      const edit = this.fixEdit(scan, finding);
      if (edit) {
        const title =
          finding.fix?.kind === 'insertFields' ? `Insert empty ${finding.fix.fields.map((f) => `"${f}"`).join(', ')}` : `Change to "${(finding.fix as { text: string }).text}"`;
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(doc.uri, new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text);
        action.diagnostics = [d];
        action.isPreferred = SAFE_FIXES.has(finding.code);
        actions.push(action);
      }
      const entry = scan.file.entries.find((e) => e.key === finding.entryKey);
      if (entry && finding.code !== 'bib/syntax') {
        const suppress = new vscode.CodeAction(`Ignore ${finding.code} for "${entry.key}"`, vscode.CodeActionKind.QuickFix);
        suppress.edit = new vscode.WorkspaceEdit();
        const edit = suppressEdit(scan.text, entry, finding.code);
        suppress.edit.insert(doc.uri, doc.positionAt(edit.start), edit.text);
        suppress.diagnostics = [d];
        actions.push(suppress);
      }
    }
    const safe = scan.result.findings.filter((f) => SAFE_FIXES.has(f.code));
    if (safe.length > 1) {
      const all = new vscode.CodeAction(`Fix all safe problems in this file (${safe.length})`, vscode.CodeActionKind.QuickFix);
      all.edit = new vscode.WorkspaceEdit();
      for (const f of safe) {
        const e = this.fixEdit(scan, f);
        if (e) all.edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
      }
      actions.push(all);
    }
    return actions;
  }

  private completions(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    const dialect = this.dialect;
    const table = fieldsData[dialect] as Record<string, string[]>;
    if (/@[a-zA-Z]*$/.test(before)) {
      const typed = /@([a-zA-Z]*)$/.exec(before)![1];
      const range = new vscode.Range(pos.line, pos.character - typed.length, pos.line, pos.character);
      return Object.entries(table).map(([type, required]) => {
        const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Struct);
        const body = required.map((alt, i) => `  ${alt.split('|')[0]} = {\${${i + 2}}},`).join('\n');
        item.insertText = new vscode.SnippetString(`${type}{\${1:key},\n${body}\n}`);
        item.detail = `required: ${required.join(', ') || 'none'}`;
        item.range = range;
        return item;
      });
    }
    if (/^\s*[a-zA-Z]*$/.test(before)) {
      const entry = parseBib(doc.getText()).entries.find((e) => doc.offsetAt(pos) > e.start && doc.offsetAt(pos) < e.end);
      if (!entry) return undefined;
      const required = (requiredFields(entry.type, dialect) ?? []).flatMap((a) => a.split('|'));
      const present = new Set(entry.fields.map((f) => f.name));
      return fieldsData.knownFields
        .filter((f) => !present.has(f))
        .map((f) => {
          const item = new vscode.CompletionItem(f, vscode.CompletionItemKind.Field);
          item.insertText = new vscode.SnippetString(`${f} = {$1},`);
          item.sortText = (required.includes(f) ? '0' : '1') + f;
          item.detail = required.includes(f) ? `required for @${entry.type}` : undefined;
          return item;
        });
    }
    return undefined;
  }
}

function toSeverity(s: Severity): vscode.DiagnosticSeverity {
  return s === 'error'
    ? vscode.DiagnosticSeverity.Error
    : s === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : s === 'info'
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Hint;
}

/** Two-step citation search: pick an entry, then pick what to do with it (wireframe 1n). */
export async function citationBrowser(projects: ProjectManager, health: BibHealth, initial?: string) {
  await projects.refresh();
  const cited = projects.citedKeys();
  const entries = projects.bibEntries();
  if (!entries.length) {
    void vscode.window.showInformationMessage('No bibliography entries found. Add \\bibliography{...} or \\addbibresource{...} to the root document.');
    return;
  }
  type Item = vscode.QuickPickItem & { entry: BibEntry; file: BibFile; bibPath: string };
  const items: Item[] = entries.map(({ entry, bib }) => {
    const d = describeEntry(bib.file, entry);
    const score = health.entryScore(entry.key);
    const flag = score && score.missingRequired ? ' · $(warning) incomplete' : score ? ` · score ${score.score}` : '';
    return {
      label: entry.key,
      description: `${d.title}${d.year ? ` · ${d.year}` : ''}`,
      detail: `${d.author || '(no author)'}${d.venue ? ` · ${d.venue}` : ''} · cited ${cited.get(entry.key)?.length ?? 0}×${flag}`,
      entry,
      file: bib.file,
      bibPath: bib.path,
    };
  });
  const pick = await new Promise<Item | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<Item>();
    qp.items = items;
    qp.placeholder = 'Search citations by key, author, title or year';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.value = initial ?? '';
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  if (!pick) return;
  const key = pick.entry.key;
  const actions = [
    { label: 'Insert key', description: `\\cite{${key}}`, id: 'cite' },
    { label: 'Insert \\citep', description: `\\citep{${key}}`, id: 'citep' },
    { label: 'Insert \\textcite', description: `\\textcite{${key}}`, id: 'textcite' },
    { label: 'Open entry', description: path.basename(pick.bibPath), id: 'open' },
    { label: 'Copy reference', description: 'plain text', id: 'copy' },
    { label: 'Where cited', description: `${cited.get(key)?.length ?? 0} locations`, id: 'where' },
  ];
  const action = await vscode.window.showQuickPick(actions, { placeHolder: `${key} — choose an action` });
  if (!action) return;
  const editor = vscode.window.activeTextEditor;
  switch (action.id) {
    case 'cite':
    case 'citep':
    case 'textcite': {
      if (!editor) return;
      // Inside an existing \cite{...} only the key is inserted.
      const before = editor.document.lineAt(editor.selection.active.line).text.slice(0, editor.selection.active.character);
      const inside = /\\[a-zA-Z]*cite[a-zA-Z]*\*?(\[[^\]]*\])*\{[^}]*$/.test(before);
      const text = inside ? key : `\\${action.id}{${key}}`;
      await editor.edit((e) => editor.selections.forEach((s) => e.replace(s, text)));
      break;
    }
    case 'open': {
      const doc = await vscode.workspace.openTextDocument(pick.bibPath);
      const ed = await vscode.window.showTextDocument(doc);
      const p = doc.positionAt(pick.entry.start);
      ed.selection = new vscode.Selection(p, p);
      ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.AtTop);
      break;
    }
    case 'copy': {
      const d = describeEntry(pick.file, pick.entry);
      await vscode.env.clipboard.writeText(`${d.author}${d.year ? ` (${d.year})` : ''}. ${d.title}. ${d.venue}`.replace(/\s+\./g, '.').trim());
      void vscode.window.showInformationMessage('Reference copied.');
      break;
    }
    case 'where': {
      const locations = (cited.get(key) ?? []).map((c) => new vscode.Location(vscode.Uri.file(c.file), new vscode.Position(c.line, 0)));
      if (!locations.length) void vscode.window.showInformationMessage(`"${key}" is not cited anywhere in the project.`);
      else await vscode.commands.executeCommand('editor.action.showReferences', locations[0].uri, locations[0].range.start, locations);
      break;
    }
  }
}
