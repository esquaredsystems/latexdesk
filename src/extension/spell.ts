// Offline spell checking of LaTeX prose (Hunspell dictionaries through nspell, in a worker).
// Language: `% !TeX spellcheck = en_GB` in the file, else the latexstudio.spell.language setting.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { ProjectManager } from './projectManager';
import { config, debounce, isTex } from './util';
import { parseMagicComments } from '../core/texParser';

interface Pending {
  resolve: (value: any) => void;
}

export class SpellChecker implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('latexstudio-spell');
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private ignored = new Map<string, Set<string>>();
  private warnedLanguages = new Set<string>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectManager,
  ) {
    const checkSoon = debounce((doc: vscode.TextDocument) => void this.check(doc), 600);
    this.disposables.push(
      this.diagnostics,
      vscode.workspace.onDidOpenTextDocument((d) => checkSoon(d)),
      vscode.workspace.onDidChangeTextDocument((e) => e.contentChanges.length && checkSoon(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.diagnostics.delete(d.uri)),
      vscode.window.onDidChangeActiveTextEditor((e) => e && checkSoon(e.document)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('latexstudio.spell')) this.recheckAll();
      }),
      vscode.languages.registerCodeActionsProvider([{ language: 'latex' }, { language: 'tex' }], { provideCodeActions: (doc, _range, ctx) => this.codeActions(doc, ctx) }),
      vscode.commands.registerCommand('latexstudio.spell.addWord', (word: string, scope: 'user' | 'project') => this.addWord(word, scope)),
      vscode.commands.registerCommand('latexstudio.spell.ignore', (uri: vscode.Uri, word: string) => {
        const set = this.ignored.get(uri.toString()) ?? new Set();
        set.add(word);
        this.ignored.set(uri.toString(), set);
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (doc) void this.check(doc);
      }),
    );
    // Check what is already open, once the extension has finished starting.
    setTimeout(() => this.recheckAll(), 2000);
  }

  dispose() {
    void this.worker?.terminate();
    this.disposables.forEach((d) => d.dispose());
  }

  private recheckAll() {
    this.diagnostics.clear();
    for (const doc of vscode.workspace.textDocuments) void this.check(doc);
  }

  private language(doc: vscode.TextDocument): string {
    const magic = parseMagicComments(doc.getText(new vscode.Range(0, 0, 40, 0)));
    return (magic.spellcheck ?? config(doc.uri).get<string>('spell.language') ?? 'en_US').replace('-', '_');
  }

  /** Finds `<lang>.aff/.dic` in the user's dictionary folder, then among the bundled ones. */
  private dictionary(lang: string): { aff: string; dic: string } | undefined {
    const custom = config().get<string>('spell.dictionaryPath');
    const folders = [custom, vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'dictionaries').fsPath].filter((f): f is string => !!f);
    for (const folder of folders) {
      const aff = path.join(folder, `${lang}.aff`);
      const dic = path.join(folder, `${lang}.dic`);
      if (fs.existsSync(aff) && fs.existsSync(dic)) return { aff, dic };
    }
    return undefined;
  }

  private words(): string[] {
    const user = config().get<string[]>('spell.words') ?? [];
    return [...user, ...this.projectWords()];
  }

  private projectDictionaryFile(): string | undefined {
    const dir = this.projects.project?.rootDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return dir ? path.join(dir, '.latexstudio', 'dictionary.txt') : undefined;
  }

  private projectWords(): string[] {
    const file = this.projectDictionaryFile();
    try {
      return file ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((w) => w.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  private request(msg: Record<string, unknown>): Promise<any> {
    if (!this.worker) {
      this.worker = new Worker(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'spellWorker.js').fsPath);
      this.worker.on('message', (reply) => {
        this.pending.get(reply.id)?.resolve(reply);
        this.pending.delete(reply.id);
      });
      this.worker.on('error', (err) => {
        for (const p of this.pending.values()) p.resolve({ error: String(err) });
        this.pending.clear();
        this.worker = undefined;
      });
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  async check(doc: vscode.TextDocument) {
    if (!isTex(doc) || doc.uri.scheme !== 'file') return;
    // Class/style files and preamble files hold settings, not prose.
    if (!config(doc.uri).get<boolean>('spell.enabled') || /\.(sty|cls)$/i.test(doc.fileName) || this.projects.isPreambleFile(doc.fileName)) {
      this.diagnostics.delete(doc.uri);
      return;
    }
    const lang = this.language(doc);
    const dict = this.dictionary(lang);
    if (!dict) {
      if (!this.warnedLanguages.has(lang)) {
        this.warnedLanguages.add(lang);
        void vscode.window.showWarningMessage(`LaTeX Studio: no dictionary for "${lang}". Put ${lang}.aff and ${lang}.dic in the folder set in latexstudio.spell.dictionaryPath.`);
      }
      return;
    }
    const version = doc.version;
    // In a file with \begin{document}, only the body is prose.
    const from = this.projects.indexDocument(doc).beginDocumentOffset ?? 0;
    const reply = await this.request({ type: 'check', ...dict, words: this.words(), text: doc.getText(), from, skipCommands: config().get<string[]>('spell.skipCommands') ?? [] });
    if (reply.error || doc.version !== version) return;
    const ignored = this.ignored.get(doc.uri.toString());
    const list = (reply.wrong as { word: string; offset: number }[])
      .filter((w) => !ignored?.has(w.word))
      .map((w) => {
        const range = new vscode.Range(doc.positionAt(w.offset), doc.positionAt(w.offset + w.word.length));
        const d = new vscode.Diagnostic(range, `"${w.word}" is not in the ${lang} dictionary`, vscode.DiagnosticSeverity.Information);
        d.source = 'spelling';
        d.code = 'spelling';
        return d;
      });
    this.diagnostics.set(doc.uri, list);
  }

  private async codeActions(doc: vscode.TextDocument, ctx: vscode.CodeActionContext): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics.filter((x) => x.source === 'spelling')) {
      const word = doc.getText(d.range);
      const dict = this.dictionary(this.language(doc));
      const reply = dict ? await this.request({ type: 'suggest', ...dict, words: this.words(), word }) : { suggestions: [] };
      for (const s of (reply.suggestions as string[] | undefined) ?? []) {
        const fix = new vscode.CodeAction(`Change to "${s}"`, vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(doc.uri, d.range, s);
        fix.diagnostics = [d];
        actions.push(fix);
      }
      const add = (title: string, command: string, args: unknown[]) => {
        const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        a.command = { command, title, arguments: args };
        a.diagnostics = [d];
        actions.push(a);
      };
      add(`Add "${word}" to the project dictionary`, 'latexstudio.spell.addWord', [word, 'project']);
      add(`Add "${word}" to my dictionary`, 'latexstudio.spell.addWord', [word, 'user']);
      add(`Ignore "${word}" in this file`, 'latexstudio.spell.ignore', [doc.uri, word]);
    }
    return actions;
  }

  private async addWord(word: string, scope: 'user' | 'project') {
    if (scope === 'user') {
      const words = config().get<string[]>('spell.words') ?? [];
      if (!words.includes(word)) await config().update('spell.words', [...words, word].sort(), vscode.ConfigurationTarget.Global);
    } else {
      const file = this.projectDictionaryFile();
      if (!file) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const words = new Set(this.projectWords());
      words.add(word);
      // One word per line, sorted, so the file merges well in version control.
      fs.writeFileSync(file, [...words].sort().join('\n') + '\n');
      this.recheckAll();
    }
  }
}
