// As-you-type checks for .tex files, separate from compiler diagnostics:
// unclosed environments, duplicate labels, undefined references and citations, obsolete commands.
import * as vscode from 'vscode';
import { ProjectManager } from './projectManager';
import { BibHealth } from './bibFeatures';
import { config, debounce, isTex } from './util';
import { maskNonCode } from '../core/text';

const OBSOLETE: { pattern: RegExp; message: string; replacement?: string }[] = [
  { pattern: /\\bf\b/g, message: '\\bf is obsolete; use \\textbf{...} or \\bfseries', replacement: '\\bfseries' },
  { pattern: /\\it\b/g, message: '\\it is obsolete; use \\textit{...} or \\itshape', replacement: '\\itshape' },
  { pattern: /\\rm\b/g, message: '\\rm is obsolete; use \\textrm{...} or \\rmfamily', replacement: '\\rmfamily' },
  { pattern: /\\tt\b/g, message: '\\tt is obsolete; use \\texttt{...} or \\ttfamily', replacement: '\\ttfamily' },
  { pattern: /\\sc\b/g, message: '\\sc is obsolete; use \\textsc{...} or \\scshape', replacement: '\\scshape' },
  { pattern: /\\begin\{eqnarray\*?\}/g, message: 'eqnarray has spacing problems; use align from amsmath' },
  { pattern: /\$\$/g, message: '$$...$$ is plain TeX; use \\[...\\] in LaTeX' },
];

export class LiveChecks implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('latexstudio-checks');
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly projects: ProjectManager, private readonly bibHealth: BibHealth) {
    const schedule = debounce(() => this.checkAll(), 400);
    this.disposables.push(
      this.collection,
      projects.onDidChange(schedule),
      bibHealth.onDidChange(schedule),
      vscode.workspace.onDidOpenTextDocument((d) => isTex(d) && schedule()),
      vscode.workspace.onDidCloseTextDocument((d) => this.collection.delete(d.uri)),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('latexstudio.checks') && schedule()),
      vscode.languages.registerCodeActionsProvider([{ language: 'latex' }], { provideCodeActions: (doc, range, ctx) => this.codeActions(doc, ctx) }),
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  checkAll() {
    if (!config().get('checks.enabled')) {
      this.collection.clear();
      return;
    }
    for (const doc of vscode.workspace.textDocuments) if (isTex(doc) && doc.uri.scheme === 'file') this.check(doc);
  }

  private check(doc: vscode.TextDocument) {
    const index = this.projects.indexDocument(doc);
    const inProject = this.projects.isInProject(doc.fileName);
    const diags: vscode.Diagnostic[] = [];
    const at = (offset: number, length: number) => new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + length));
    const add = (range: vscode.Range, message: string, code: string, severity = vscode.DiagnosticSeverity.Warning) => {
      const d = new vscode.Diagnostic(range, message, severity);
      d.source = 'LaTeX Studio';
      d.code = code;
      diags.push(d);
    };

    for (const u of index.unbalancedEnvironments) {
      const message =
        u.problem === 'unopened' ? `\\end{${u.name}} has no matching \\begin` : u.problem === 'mismatch' ? `\\begin{${u.name}} is not closed before \\end{${u.expected}}` : `\\begin{${u.name}} is never closed`;
      add(at(u.offset, u.name.length + 8), message, 'tex/unbalanced-environment', vscode.DiagnosticSeverity.Error);
    }

    if (inProject) {
      const labels = this.projects.allLabels();
      const counts = new Map<string, number>();
      for (const l of labels) counts.set(l.label.name, (counts.get(l.label.name) ?? 0) + 1);
      for (const l of index.labels) {
        if ((counts.get(l.name) ?? 0) > 1) add(at(l.offset, l.name.length), `Label "${l.name}" is defined more than once in the project`, 'tex/duplicate-label');
      }
      for (const r of index.references) {
        if (!counts.has(r.name)) add(at(r.offset, r.name.length), `Label "${r.name}" is not defined in this project`, 'tex/undefined-ref');
      }
      // Citations can only be checked when the bibliography files were found.
      if (this.projects.bibs.size > 0) {
        for (const c of index.citations) {
          const found = this.projects.findEntry(c.key);
          if (!found) add(at(c.offset, c.key.length), `No bibliography entry for "${c.key}"`, 'tex/undefined-cite');
          else {
            const score = this.bibHealth.entryScore(c.key);
            if (score && score.missingRequired) {
              add(at(c.offset, c.key.length), `"${c.key}" is missing required fields: ${score.missingRequired}`, 'tex/incomplete-cite', vscode.DiagnosticSeverity.Information);
            }
          }
        }
      }
    }

    const masked = maskNonCode(doc.getText());
    for (const rule of OBSOLETE) {
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(masked))) {
        add(at(m.index, m[0].length), rule.message, 'tex/obsolete', vscode.DiagnosticSeverity.Hint);
      }
    }
    this.collection.set(doc.uri, diags);
  }

  private codeActions(doc: vscode.TextDocument, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      if (d.code === 'tex/obsolete') {
        const rule = OBSOLETE.find((r) => d.message === r.message);
        if (rule?.replacement) {
          const fix = new vscode.CodeAction(`Replace with ${rule.replacement}`, vscode.CodeActionKind.QuickFix);
          fix.edit = new vscode.WorkspaceEdit();
          fix.edit.replace(doc.uri, d.range, rule.replacement);
          fix.diagnostics = [d];
          actions.push(fix);
        }
      }
      if (d.source === 'LaTeX' || d.source === 'bibtex' || d.source === 'biber') {
        const explain = new vscode.CodeAction('Explain this error', vscode.CodeActionKind.QuickFix);
        explain.command = { command: 'latexstudio.explainError', title: 'Explain this error', arguments: [d.message] };
        explain.diagnostics = [d];
        actions.push(explain);
      }
      if (d.code === 'tex/undefined-cite') {
        const search = new vscode.CodeAction('Search bibliographies…', vscode.CodeActionKind.QuickFix);
        search.command = { command: 'latexstudio.citationBrowser', title: 'Search', arguments: [doc.getText(d.range)] };
        actions.push(search);
      }
    }
    return actions;
  }
}
