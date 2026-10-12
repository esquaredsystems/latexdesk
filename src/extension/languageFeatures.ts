// Completion, hover, go to definition, references, symbols, folding and links for LaTeX.
// Rename lives in rename.ts.
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import latexData from '../../data/latex.json';
import { ProjectManager } from './projectManager';
import { argumentAt, mathAt, openArgument } from './texContext';
import { config } from './util';
import { describeEntry } from '../core/bibParser';
import { isCiteCommand, TexFileIndex } from '../core/texParser';
import { GRAPHIC_EXTENSIONS } from '../core/project';

type CommandData = [string, string, string, string];
type EnvData = [string, string, string];
const COMMANDS = latexData.commands as CommandData[];
const ENVIRONMENTS = latexData.environments as EnvData[];
const SELECTOR: vscode.DocumentSelector = [{ language: 'latex' }, { language: 'tex' }];

export interface EntryScoreLookup {
  (key: string): { score: number; issues: number } | undefined;
}

export function registerLanguageFeatures(context: vscode.ExtensionContext, projects: ProjectManager, entryScore: EntryScoreLookup) {
  const refCommands = () => new Set(config().get<string[]>('completion.refCommands') ?? []);
  const isCite = (cmd: string) => isCiteCommand(cmd, config().get<string[]>('completion.citeCommands') ?? []);

  // ---------- completion ----------
  const completion: vscode.CompletionItemProvider = {
    async provideCompletionItems(doc, pos) {
      const arg = openArgument(doc, pos);
      if (arg) return argumentCompletions(doc, pos, arg);
      const before = doc.lineAt(pos.line).text.slice(0, pos.character);
      const cmd = /\\([a-zA-Z@]*)$/.exec(before);
      if (cmd) return commandCompletions(new vscode.Range(pos.line, pos.character - cmd[1].length, pos.line, pos.character));
      return undefined;
    },
  };

  function commandCompletions(range: vscode.Range): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const loaded = new Set(projects.packages());
    for (const [name, args, description, pkg] of COMMANDS) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.insertText = new vscode.SnippetString(name + args.replace(/\$\{(\d+)\}/g, '${$1}'));
      item.detail = pkg ? `${description} (${pkg})` : description;
      item.range = range;
      // Commands from packages that are not loaded sort lower.
      item.sortText = (pkg && !loaded.has(pkg) ? '2' : '1') + name;
      items.push(item);
    }
    for (const f of projects.project?.files ?? []) {
      for (const def of f.index.commandDefs) {
        const item = new vscode.CompletionItem(def.name, vscode.CompletionItemKind.Variable);
        const args = Array.from({ length: def.argCount }, (_, i) => `{\${${i + 1}}}`).join('');
        item.insertText = new vscode.SnippetString(def.name + args);
        item.detail = `defined in ${path.basename(f.path)}`;
        item.documentation = new vscode.MarkdownString().appendCodeblock(def.body.slice(0, 300), 'latex');
        item.range = range;
        item.sortText = '0' + def.name;
        items.push(item);
      }
    }
    return items;
  }

  async function argumentCompletions(doc: vscode.TextDocument, pos: vscode.Position, arg: NonNullable<ReturnType<typeof openArgument>>) {
    const { command, range } = arg;
    if (isCite(command)) {
      const cited = projects.citedKeys();
      return projects.bibEntries().map(({ entry, bib }) => {
        const d = describeEntry(bib.file, entry);
        const item = new vscode.CompletionItem({ label: entry.key, description: [d.author.split(/\s+and\s+/)[0], d.year].filter(Boolean).join(' · ') }, vscode.CompletionItemKind.Reference);
        item.detail = d.title;
        const score = entryScore(entry.key);
        item.documentation = new vscode.MarkdownString(
          `**${d.title || '(no title)'}**\n\n${d.author}${d.year ? ` (${d.year})` : ''}\n\n${d.venue}\n\n` +
            `_${path.basename(bib.path)}_ · cited ${cited.get(entry.key)?.length ?? 0}×${score ? ` · score ${score.score}` : ''}`,
        );
        item.filterText = `${entry.key} ${d.author} ${d.title} ${d.year}`;
        item.range = range;
        return item;
      });
    }
    if (refCommands().has(command)) {
      return projects.allLabels().map(({ label, file }) => {
        const item = new vscode.CompletionItem({ label: label.name, description: label.kind }, vscode.CompletionItemKind.Reference);
        item.detail = label.caption ? `${label.kind}: ${label.caption}` : label.kind;
        item.documentation = `${path.basename(file)}:${label.line + 1}`;
        item.range = range;
        return item;
      });
    }
    if (command === 'begin' || command === 'end') {
      const envs = new Map<string, string>();
      for (const [name, description] of ENVIRONMENTS) envs.set(name, description);
      for (const f of projects.project?.files ?? []) for (const d of f.index.environmentDefs) envs.set(d.name, `defined in ${path.basename(f.path)}`);
      if (command === 'end') {
        const open = innermostOpenEnvironment(projects.indexDocument(doc), doc.offsetAt(pos));
        if (open) envs.set(open, 'closes the open environment');
      }
      return [...envs].map(([name, description]) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
        item.detail = description;
        if (command === 'begin') {
          // Complete the matching \end as well; replace the auto-inserted closing brace.
          const replace = arg.closedAfter ? new vscode.Range(range.start, range.end.translate(0, 1)) : range;
          item.range = replace;
          const indent = doc.lineAt(pos.line).text.match(/^\s*/)?.[0] ?? '';
          item.insertText = new vscode.SnippetString(`${name}}\n${indent}\t$0\n${indent}\\end{${name}}`);
        } else {
          item.range = range;
        }
        return item;
      });
    }
    if (command === 'usepackage' || command === 'RequirePackage') {
      return latexData.packages.map((p) => Object.assign(new vscode.CompletionItem(p, vscode.CompletionItemKind.Module), { range }));
    }
    if (command === 'documentclass') {
      return latexData.classes.map((c) => Object.assign(new vscode.CompletionItem(c, vscode.CompletionItemKind.Class), { range }));
    }
    if (['input', 'include', 'subfile', 'includeonly', 'includegraphics', 'bibliography', 'addbibresource'].includes(command)) {
      return fileCompletions(doc, command, range);
    }
    return undefined;
  }

  async function fileCompletions(doc: vscode.TextDocument, command: string, range: vscode.Range) {
    const root = projects.root ?? doc.fileName;
    const rootDir = path.dirname(root);
    const pattern = command === 'includegraphics' ? `**/*.{${GRAPHIC_EXTENSIONS.map((e) => e.slice(1).toLowerCase()).join(',')}}` : command.startsWith('bib') || command === 'addbibresource' ? '**/*.bib' : '**/*.tex';
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(rootDir, pattern), '**/{node_modules,.git,.latexstudio}/**', 2000);
    const graphicsPaths = projects.project?.files.flatMap((f) => f.index.graphicsPaths) ?? [];
    const items = new Map<string, vscode.CompletionItem>();
    for (const uri of uris) {
      let rel = path.relative(rootDir, uri.fsPath).split(path.sep).join('/');
      if (command === 'includegraphics') {
        const viaPath = graphicsPaths.find((g) => rel.startsWith(g.replace(/^\.\//, '')));
        if (viaPath) rel = rel.slice(viaPath.replace(/^\.\//, '').length);
        rel = rel.replace(/\.(pdf|png|jpe?g)$/i, '');
      } else if (command !== 'addbibresource') {
        rel = rel.replace(/\.(tex|bib)$/, '');
      }
      const item = new vscode.CompletionItem(rel, vscode.CompletionItemKind.File);
      item.range = range;
      items.set(rel, item);
    }
    return [...items.values()];
  }

  // ---------- hover ----------
  const hover: vscode.HoverProvider = {
    async provideHover(doc, pos) {
      const arg = argumentAt(doc, pos);
      if (arg && isCite(arg.command)) return citationHover(arg.item, arg.itemRange);
      if (arg && refCommands().has(arg.command)) return labelHover(arg.item, arg.itemRange);
      if (arg && arg.command === 'includegraphics') return graphicHover(arg.arg, arg.argRange);
      // Inside math, a rendered preview is more useful than the description of one symbol.
      if (config().get('hover.math')) {
        const math = mathAt(doc, pos);
        if (math) return mathHover(math.tex, math.display, math.range);
      }
      const word = doc.getWordRangeAtPosition(pos, /\\[a-zA-Z@]+/);
      if (word) {
        const name = doc.getText(word).slice(1);
        const known = COMMANDS.find((c) => c[0] === name);
        const def = projects.project?.files.flatMap((f) => f.index.commandDefs.map((d) => ({ d, f }))).find((x) => x.d.name === name);
        if (known || def) {
          const md = new vscode.MarkdownString();
          if (known) md.appendMarkdown(`\`\\${name}${known[1].replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\n[\s\S]*/, '')}\`  \n${known[2]}${known[3] ? ` — package \`${known[3]}\`` : ''}`);
          if (def) md.appendMarkdown(`${known ? '\n\n' : ''}Defined in ${path.basename(def.f.path)}:${def.d.line + 1}`).appendCodeblock(def.d.body.slice(0, 400), 'latex');
          return new vscode.Hover(md, word);
        }
      }
      return undefined;
    },
  };

  function citationHover(key: string, range: vscode.Range) {
    const found = projects.findEntry(key);
    if (!found) return new vscode.Hover(new vscode.MarkdownString(`$(warning) No bibliography entry for \`${key}\``, true), range);
    const d = describeEntry(found.bib.file, found.entry);
    const score = entryScore(key);
    const cited = projects.citedKeys().get(key)?.length ?? 0;
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${escapeMd(d.title || '(no title)')}**  \n${escapeMd(d.author)}${d.year ? ` (${d.year})` : ''}  \n_${escapeMd(d.venue)}_\n\n`);
    md.appendMarkdown(`\`@${d.type}\` · ${path.basename(found.bib.path)}:${found.entry.line + 1} · cited ${cited}×`);
    if (score) md.appendMarkdown(` · completeness ${score.score}/100${score.issues ? ` · $(warning) ${score.issues} issue${score.issues > 1 ? 's' : ''}` : ''}`);
    return new vscode.Hover(md, range);
  }

  function labelHover(name: string, range: vscode.Range) {
    const found = projects.allLabels().find((l) => l.label.name === name);
    if (!found) return new vscode.Hover(new vscode.MarkdownString(`$(warning) Label \`${name}\` is not defined in this project`, true), range);
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${found.label.kind}**${found.label.caption ? `: ${escapeMd(found.label.caption)}` : ''}  \n${path.basename(found.file)}:${found.label.line + 1}`);
    const number = resolvedNumber(name);
    if (number) md.appendMarkdown(`  \nNumber from the last build: **${number}**`);
    return new vscode.Hover(md, range);
  }

  /** Reads `\newlabel{name}{{3.2}{14}...}` from the .aux file of the last build. */
  function resolvedNumber(name: string): string | undefined {
    const out = projects.output();
    if (!out) return undefined;
    try {
      const aux = fs.readFileSync(path.join(out.outDir, out.jobName + '.aux'), 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\\\newlabel\\{${escaped}\\}\\{\\{([^}]*)\\}`).exec(aux)?.[1];
    } catch {
      return undefined;
    }
  }

  function graphicHover(name: string, range: vscode.Range) {
    const target = projects.project?.graphics.find((g) => g.target === name)?.resolved;
    if (!target) return new vscode.Hover(`Image \`${name}\` was not found in the graphics path`, range);
    if (/\.(png|jpe?g|svg|gif)$/i.test(target)) {
      const md = new vscode.MarkdownString(`![${name}](${vscode.Uri.file(target).toString()}|width=320)\n\n${path.basename(target)}`);
      md.supportHtml = true;
      return new vscode.Hover(md, range);
    }
    return new vscode.Hover(`${path.basename(target)} (no preview for this format)`, range);
  }

  async function mathHover(tex: string, display: boolean, range: vscode.Range) {
    try {
      const { renderSvg } = await loadMathJax(context);
      const macros = (projects.project?.files ?? []).flatMap((f) => f.index.commandDefs).filter((d) => d.body);
      const svg = renderSvg(tex, display, macros.map((m) => ({ name: m.name, args: m.argCount, body: m.body })));
      const dark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
      const colored = svg.replace(/currentColor/g, dark ? '#eeeeee' : '#222222');
      const md = new vscode.MarkdownString(`![math](data:image/svg+xml;base64,${Buffer.from(colored).toString('base64')})\n\n_Preview (approximate; the PDF may differ)_`);
      return new vscode.Hover(md, range);
    } catch (err) {
      return new vscode.Hover(`Math preview failed: ${String(err)}`, range);
    }
  }

  // ---------- definition & references ----------
  const definition: vscode.DefinitionProvider = {
    async provideDefinition(doc, pos) {
      const arg = argumentAt(doc, pos);
      if (arg && refCommands().has(arg.command)) {
        const found = projects.allLabels().find((l) => l.label.name === arg.item);
        return found ? new vscode.Location(vscode.Uri.file(found.file), new vscode.Position(found.label.line, 0)) : undefined;
      }
      if (arg && isCite(arg.command)) {
        const found = projects.findEntry(arg.item);
        return found ? new vscode.Location(vscode.Uri.file(found.bib.path), new vscode.Position(found.entry.line, 0)) : undefined;
      }
      if (arg && ['input', 'include', 'subfile', 'bibliography', 'addbibresource', 'includegraphics'].includes(arg.command)) {
        const target = linkTarget(doc, arg.command, arg.item);
        return target ? new vscode.Location(vscode.Uri.file(target), new vscode.Position(0, 0)) : undefined;
      }
      const word = doc.getWordRangeAtPosition(pos, /\\[a-zA-Z@]+/);
      if (word) {
        const name = doc.getText(word).slice(1);
        for (const f of projects.project?.files ?? []) {
          const def = f.index.commandDefs.find((d) => d.name === name);
          if (def) return new vscode.Location(vscode.Uri.file(f.path), new vscode.Position(def.line, 0));
        }
      }
      return undefined;
    },
  };

  const references: vscode.ReferenceProvider = {
    provideReferences(doc, pos, ctx) {
      const arg = argumentAt(doc, pos);
      if (!arg) return undefined;
      const result: vscode.Location[] = [];
      const files = projects.project?.files ?? [];
      if (arg.command === 'label' || refCommands().has(arg.command)) {
        for (const f of files) {
          for (const r of f.index.references) if (r.name === arg.item) result.push(locationOf(f.path, r.offset, r.name));
          if (ctx.includeDeclaration) for (const l of f.index.labels) if (l.name === arg.item) result.push(locationOf(f.path, l.offset, l.name));
        }
      } else if (isCite(arg.command)) {
        for (const f of files) for (const c of f.index.citations) if (c.key === arg.item) result.push(locationOf(f.path, c.offset, c.key));
      }
      return result;
    },
  };

  /** Converts a character offset in a project file into a Location (reads the open document or disk). */
  function locationOf(file: string, offset: number, text: string): vscode.Location {
    const open = vscode.workspace.textDocuments.find((d) => d.fileName === file);
    let pos: vscode.Position;
    if (open) pos = open.positionAt(offset);
    else {
      const content = fs.readFileSync(file, 'utf8').slice(0, offset);
      const lines = content.split('\n');
      pos = new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    }
    return new vscode.Location(vscode.Uri.file(file), new vscode.Range(pos, pos.translate(0, text.length)));
  }

  // ---------- symbols, folding, links ----------
  const symbols: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(doc) {
      const index = projects.indexDocument(doc);
      const roots: vscode.DocumentSymbol[] = [];
      const stack: { level: number; symbol: vscode.DocumentSymbol }[] = [];
      const sections = index.sections;
      sections.forEach((s, i) => {
        const next = sections.slice(i + 1).find((n) => n.level <= s.level);
        const endLine = next ? Math.max(next.line - 1, s.line) : doc.lineCount - 1;
        const range = new vscode.Range(s.line, 0, endLine, doc.lineAt(endLine).text.length);
        const sym = new vscode.DocumentSymbol(s.title || s.command, s.command, s.level <= 1 ? vscode.SymbolKind.Namespace : vscode.SymbolKind.Module, range, new vscode.Range(s.line, 0, s.line, 0));
        while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
        if (stack.length) stack[stack.length - 1].symbol.children.push(sym);
        else roots.push(sym);
        stack.push({ level: s.level, symbol: sym });
      });
      for (const l of index.labels) {
        const sym = new vscode.DocumentSymbol(l.name, l.caption ?? l.kind, vscode.SymbolKind.Key, new vscode.Range(l.line, 0, l.line, 0), new vscode.Range(l.line, 0, l.line, 0));
        const parent = deepestContaining(roots, l.line);
        if (parent) parent.children.push(sym);
        else roots.push(sym);
      }
      return roots;
    },
  };

  const folding: vscode.FoldingRangeProvider = {
    provideFoldingRanges(doc) {
      const index = projects.indexDocument(doc);
      const ranges: vscode.FoldingRange[] = [];
      index.sections.forEach((s, i) => {
        const next = index.sections.slice(i + 1).find((n) => n.level <= s.level);
        let end = next ? next.line - 1 : doc.lineCount - 1;
        // Stop at \end{document} so the last section does not swallow it.
        const endDoc = index.environments.find((e) => e.name === 'document')?.endLine;
        if (endDoc !== undefined && endDoc > s.line && endDoc <= end) end = endDoc - 1;
        while (end > s.line && doc.lineAt(end).isEmptyOrWhitespace) end--;
        if (end > s.line) ranges.push(new vscode.FoldingRange(s.line, end));
      });
      for (const env of index.environments) {
        if (env.endLine !== undefined && env.endLine > env.beginLine && env.name !== 'document') ranges.push(new vscode.FoldingRange(env.beginLine, env.endLine));
      }
      let commentStart = -1;
      for (let i = 0; i <= doc.lineCount; i++) {
        const isComment = i < doc.lineCount && /^\s*%/.test(doc.lineAt(i).text);
        if (isComment && commentStart < 0) commentStart = i;
        if (!isComment && commentStart >= 0) {
          if (i - 1 > commentStart) ranges.push(new vscode.FoldingRange(commentStart, i - 1, vscode.FoldingRangeKind.Comment));
          commentStart = -1;
        }
      }
      return ranges;
    },
  };

  function linkTarget(doc: vscode.TextDocument, command: string, value: string): string | undefined {
    const rootDir = path.dirname(projects.root ?? doc.fileName);
    const dirs = [rootDir, path.dirname(doc.fileName)];
    const exts =
      command === 'includegraphics' ? ['', ...GRAPHIC_EXTENSIONS] : command === 'bibliography' ? ['.bib'] : command === 'addbibresource' ? [''] : ['.tex', ''];
    if (command === 'includegraphics') {
      const resolved = projects.project?.graphics.find((g) => g.target === value)?.resolved;
      if (resolved) return resolved;
    }
    for (const dir of dirs) for (const ext of exts) {
      const p = path.resolve(dir, value + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return undefined;
  }

  const links: vscode.DocumentLinkProvider = {
    provideDocumentLinks(doc) {
      const result: vscode.DocumentLink[] = [];
      const index = projects.indexDocument(doc);
      const add = (command: string, value: string, offset: number) => {
        const target = linkTarget(doc, command, value);
        if (!target) return;
        const start = doc.positionAt(offset);
        result.push(new vscode.DocumentLink(new vscode.Range(start, start.translate(0, value.length)), vscode.Uri.file(target)));
      };
      for (const inc of index.includes) if (inc.kind !== 'import') add(inc.kind === 'subfile' ? 'subfile' : 'input', inc.path, inc.offset);
      for (const g of index.graphics) add('includegraphics', g.path, g.offset);
      for (const b of index.bibResources) add(b.path.endsWith('.bib') ? 'addbibresource' : 'bibliography', b.path, b.offset);
      return result;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, completion, '\\', '{', ',', '/'),
    vscode.languages.registerHoverProvider(SELECTOR, hover),
    vscode.languages.registerDefinitionProvider(SELECTOR, definition),
    vscode.languages.registerReferenceProvider(SELECTOR, references),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, symbols),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, folding),
    vscode.languages.registerDocumentLinkProvider(SELECTOR, links),
  );
}

function deepestContaining(symbols: vscode.DocumentSymbol[], line: number): vscode.DocumentSymbol | undefined {
  for (const s of symbols) {
    if (s.kind !== vscode.SymbolKind.Key && s.range.start.line <= line && s.range.end.line >= line) return deepestContaining(s.children, line) ?? s;
  }
  return undefined;
}

export function innermostOpenEnvironment(index: TexFileIndex, offset: number): string | undefined {
  const open = index.environments.filter((e) => e.beginOffset < offset && (e.endOffset === undefined || e.endOffset >= offset));
  return open.sort((a, b) => b.beginOffset - a.beginOffset)[0]?.name;
}

function escapeMd(s: string) {
  return s.replace(/[*_`[\]]/g, '\\$&');
}

let mathjax: Promise<typeof import('./mathjax')> | undefined;
function loadMathJax(context: vscode.ExtensionContext) {
  // MathJax lives in its own bundle and is only loaded on the first math hover.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the path is only known at runtime
  mathjax ??= Promise.resolve(require(vscode.Uri.joinPath(context.extensionUri, 'dist', 'mathjax.js').fsPath));
  return mathjax;
}
