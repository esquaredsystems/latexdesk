// Sidebar tree views (wireframe 1b): Build, Structure, Files, Bibliography, Labels, Output files.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectManager } from './projectManager';
import { BuildManager } from './buildManager';
import { BibHealth } from './bibFeatures';
import { config, debounce } from './util';
import { countWords } from '../core/wordCount';
import { describeEntry } from '../core/bibParser';
import { listOutputs } from '../build/outputs';
import { ProjectFile } from '../core/project';

type Node = vscode.TreeItem & { children?: Node[] };

function item(label: string, options: Partial<vscode.TreeItem> & { children?: Node[] } = {}): Node {
  const node = new vscode.TreeItem(label, options.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None) as Node;
  Object.assign(node, options);
  return node;
}

function openAt(file: string, line: number): vscode.Command {
  return { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(file), { selection: new vscode.Range(line, 0, line, 0) }] };
}

function shortCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

abstract class SimpleTree implements vscode.TreeDataProvider<Node> {
  protected readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  refresh() {
    this.emitter.fire(undefined);
  }
  getTreeItem(node: Node) {
    return node;
  }
  getChildren(node?: Node): Node[] {
    return node ? node.children ?? [] : this.roots();
  }
  protected abstract roots(): Node[];
}

class BuildTree extends SimpleTree {
  constructor(private readonly builds: BuildManager, private readonly projects: ProjectManager, private readonly context: vscode.ExtensionContext) {
    super();
  }
  protected roots(): Node[] {
    const s = this.builds.state;
    const recipe = this.context.workspaceState.get<string>('latexdesk.recipe') ?? config().get<string>('build.recipe') ?? 'latexmk (pdf)';
    const auto = config().get('build.autoBuild') === 'onSave';
    const status =
      s.phase === 'building'
        ? `Building · ${s.step ?? ''}`
        : s.phase === 'succeeded'
          ? `Built in ${((s.durationMs ?? 0) / 1000).toFixed(1)} s`
          : s.phase === 'failed'
            ? `Build failed${s.message ? ` · ${s.message}` : ''}`
            : s.phase === 'cancelled'
              ? 'Build stopped'
              : 'Not built yet';
    const icon = s.phase === 'building' ? 'sync~spin' : s.phase === 'succeeded' ? 'pass' : s.phase === 'failed' ? 'error' : 'circle-outline';
    const nodes: Node[] = [
      item('Build project', { iconPath: new vscode.ThemeIcon('play'), description: process.platform === 'darwin' ? '⌘⌥B' : 'Ctrl+Alt+B', command: { command: 'latexdesk.build', title: 'Build' } }),
      item('Fast preview build', { iconPath: new vscode.ThemeIcon('zap'), description: 'draft images', command: { command: 'latexdesk.buildFast', title: 'Fast preview' } }),
      item('Build this chapter only', { iconPath: new vscode.ThemeIcon('split-horizontal'), description: 'partial', command: { command: 'latexdesk.buildPartial', title: 'Partial build' } }),
      item('Rebuild from scratch', { iconPath: new vscode.ThemeIcon('refresh'), command: { command: 'latexdesk.rebuild', title: 'Rebuild' } }),
    ];
    if (s.phase === 'building') nodes.push(item('Stop build', { iconPath: new vscode.ThemeIcon('debug-stop'), command: { command: 'latexdesk.stopBuild', title: 'Stop' } }));
    nodes.push(
      item('Clean aux files', { iconPath: new vscode.ThemeIcon('trash'), command: { command: 'latexdesk.clean', title: 'Clean' } }),
      item('View PDF', { iconPath: new vscode.ThemeIcon('open-preview'), command: { command: 'latexdesk.viewPdf', title: 'View PDF' } }),
      item(`Recipe ▸ ${recipe}`, { iconPath: new vscode.ThemeIcon('list-ordered'), command: { command: 'latexdesk.selectRecipe', title: 'Select recipe' } }),
      item(`Build on save: ${auto ? 'on' : 'off'}`, { iconPath: new vscode.ThemeIcon(auto ? 'check' : 'circle-slash'), command: { command: 'latexdesk.toggleAutoBuild', title: 'Toggle' } }),
      item(`Root ▸ ${this.projects.root ? path.basename(this.projects.root) : 'none'}`, { iconPath: new vscode.ThemeIcon('home'), command: { command: 'latexdesk.selectRoot', title: 'Select root' } }),
      item(status, {
        iconPath: new vscode.ThemeIcon(icon),
        description: s.phase !== 'idle' ? `${s.errors} errors · ${s.warnings} warnings` : undefined,
        command: { command: 'latexdesk.openLogViewer', title: 'Open log' },
      }),
    );
    return nodes;
  }
}

export type StructureKind = 'sections' | 'floats' | 'labels' | 'todos';

class StructureTree extends SimpleTree {
  filter = new Set<StructureKind>(['sections', 'floats', 'todos']);
  private wordCache = new Map<string, { version: string; counts: number[] }>();

  constructor(private readonly projects: ProjectManager) {
    super();
  }

  protected roots(): Node[] {
    const project = this.projects.project;
    if (!project) return [];
    const counts = { sections: 0, labels: 0, floats: 0, equations: 0, todos: 0 };
    for (const f of project.files) {
      counts.sections += f.index.sections.length;
      counts.labels += f.index.labels.length;
      counts.floats += f.index.labels.filter((l) => /figure|table|algorithm/.test(l.kind)).length;
      counts.equations += f.index.labels.filter((l) => /equation|align|gather|multline/.test(l.kind)).length;
      counts.todos += f.index.todos.length;
    }
    const header = item(`§ ${counts.sections} · label ${counts.labels} · float ${counts.floats} · eq ${counts.equations} · TODO ${counts.todos}`, {
      iconPath: new vscode.ThemeIcon('filter'),
      tooltip: 'Click to choose what the structure shows',
      command: { command: 'latexdesk.structureFilter', title: 'Filter' },
    });

    // Walk the project in document order, following includes where they appear.
    type Entry = { level: number; node: Node };
    const roots: Node[] = [];
    const stack: Entry[] = [];
    const visited = new Set<string>();
    const add = (level: number, node: Node) => {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) (parent.node.children ??= []).push(node);
      else roots.push(node);
      if (level < 100) stack.push({ level, node });
    };

    const walk = (file: ProjectFile) => {
      if (visited.has(file.path)) return;
      visited.add(file.path);
      const words = this.sectionWords(file);
      const issues = vscode.languages.getDiagnostics(vscode.Uri.file(file.path)).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
      const events: { offset: number; run: () => void }[] = [];
      if (this.filter.has('sections')) {
        file.index.sections.forEach((s, i) => {
          const next = file.index.sections[i + 1];
          const errors = issues.filter((d) => d.range.start.line >= s.line && (!next || d.range.start.line < next.line)).length;
          events.push({
            offset: s.offset,
            run: () =>
              add(s.level, item(s.title || s.command, {
                description: `${errors ? `⊗${errors}  ` : ''}${words[i] ? shortCount(words[i]) : ''}`,
                tooltip: `${s.command} · ${path.basename(file.path)}:${s.line + 1}${words[i] ? ` · ≈${words[i]} words` : ''}`,
                iconPath: new vscode.ThemeIcon(s.level <= 1 ? 'book' : 'symbol-namespace'),
                command: openAt(file.path, s.line),
              })),
          });
        });
      }
      for (const l of file.index.labels) {
        const isFloat = /figure|table|algorithm/.test(l.kind);
        if ((isFloat && this.filter.has('floats')) || (!isFloat && this.filter.has('labels'))) {
          const kind = l.kind.replace(/\*$/, '');
          events.push({
            offset: l.offset,
            run: () => add(100, item(`${kind[0].toUpperCase()}${kind.slice(1)}: ${l.name}`, { description: l.caption, iconPath: new vscode.ThemeIcon(isFloat ? 'file-media' : 'tag'), command: openAt(file.path, l.line) })),
          });
        }
      }
      if (this.filter.has('todos')) {
        for (const t of file.index.todos) {
          events.push({ offset: t.offset, run: () => add(100, item(`${t.tag} ${t.text}`, { iconPath: new vscode.ThemeIcon('checklist'), command: openAt(file.path, t.line) })) });
        }
      }
      for (const child of file.children) {
        const childFile = this.projects.project?.files.find((f) => f.path === child.path);
        if (childFile) events.push({ offset: child.offset, run: () => walk(childFile) });
      }
      events.sort((a, b) => a.offset - b.offset).forEach((e) => e.run());
    };
    walk(project.files[0]);

    // Expand chapters and parts by default; everything else starts collapsed.
    const setState = (nodes: Node[], depth: number) => {
      for (const n of nodes) {
        if (n.children?.length) {
          n.collapsibleState = depth === 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
          setState(n.children, depth + 1);
        }
      }
    };
    setState(roots, 0);
    return [header, ...roots];
  }

  /** Approximate words per section of one file (cached until the file's index changes). */
  private sectionWords(file: ProjectFile): number[] {
    const version = `${file.index.sections.length}:${file.index.sections.map((s) => s.offset).join(',')}`;
    const cached = this.wordCache.get(file.path);
    const open = vscode.workspace.textDocuments.find((d) => d.fileName === file.path);
    const cacheKey = version + (open ? `:${open.version}` : '');
    if (cached && cached.version === cacheKey) return cached.counts;
    let text: string;
    try {
      text = open ? open.getText() : fs.readFileSync(file.path, 'utf8');
    } catch {
      return [];
    }
    // A section's count includes its subsections: it runs to the next section of the same or a higher level.
    const sections = file.index.sections;
    const counts = sections.map((s, i) => {
      const end = sections.slice(i + 1).find((n) => n.level <= s.level)?.offset ?? text.length;
      return countWords(text.slice(s.offset, end), { documentOnly: false });
    });
    this.wordCache.set(file.path, { version: cacheKey, counts });
    return counts;
  }
}

class FilesTree extends SimpleTree {
  constructor(private readonly projects: ProjectManager) {
    super();
  }
  protected roots(): Node[] {
    const project = this.projects.project;
    if (!project) return [];
    const visited = new Set<string>();
    const nodeFor = (file: ProjectFile, isRoot: boolean): Node => {
      visited.add(file.path);
      const children: Node[] = file.children
        .filter((c) => !visited.has(c.path))
        .map((c) => project.files.find((f) => f.path === c.path))
        .filter((f): f is ProjectFile => !!f)
        .map((f) => nodeFor(f, false));
      for (const u of project.unresolved.filter((u) => u.file === file.path && u.kind === 'include')) {
        children.push(item(`${u.target} (not found)`, { iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground')), command: openAt(file.path, u.line) }));
      }
      const node = item(path.relative(project.rootDir, file.path) || path.basename(file.path), {
        resourceUri: vscode.Uri.file(file.path),
        description: isRoot ? 'root' : undefined,
        command: openAt(file.path, 0),
        children,
      });
      if (isRoot) node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      return node;
    };
    const nodes = [nodeFor(project.files[0], true)];
    for (const bib of project.bibFiles) nodes.push(item(path.relative(project.rootDir, bib), { resourceUri: vscode.Uri.file(bib), command: openAt(bib, 0) }));
    for (const sty of project.styleFiles) nodes.push(item(path.relative(project.rootDir, sty), { resourceUri: vscode.Uri.file(sty), command: openAt(sty, 0) }));
    for (const u of project.unresolved.filter((u) => u.kind === 'bibliography')) {
      nodes.push(item(`${u.target}.bib (not found)`, { iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground')), command: openAt(u.file, u.line) }));
    }
    const missingGraphics = project.unresolved.filter((u) => u.kind === 'graphic');
    const graphics = project.graphics.filter((g) => g.resolved);
    nodes.push(
      item(`Graphics`, {
        iconPath: new vscode.ThemeIcon('file-media'),
        description: `${graphics.length} found${missingGraphics.length ? ` · ${missingGraphics.length} missing` : ''}`,
        children: [
          ...missingGraphics.map((g) => item(`${g.target} (not found)`, { iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground')), description: `${path.basename(g.file)}:${g.line + 1}`, command: openAt(g.file, g.line) })),
          ...graphics.map((g) => item(g.target, { resourceUri: vscode.Uri.file(g.resolved!), description: path.basename(g.resolved!), command: openAt(g.file, g.line) })),
        ],
      }),
    );
    return nodes;
  }
}

class CitationsTree extends SimpleTree {
  constructor(private readonly projects: ProjectManager, private readonly health: BibHealth) {
    super();
  }
  protected roots(): Node[] {
    const cited = this.projects.citedKeys();
    const nodes: Node[] = [];
    for (const bib of this.projects.bibs.values()) {
      const children = bib.file.entries.map((entry) => {
        const d = describeEntry(bib.file, entry);
        const count = cited.get(entry.key)?.length ?? 0;
        const score = this.health.entryScore(entry.key);
        return item(entry.key, {
          description: `${count}× · ${d.title}`,
          tooltip: `${d.author} (${d.year})\n${d.title}\n${d.venue}${score ? `\nscore ${score.score}/100` : ''}`,
          iconPath: new vscode.ThemeIcon(score?.missingRequired ? 'warning' : count ? 'book' : 'circle-outline'),
          command: openAt(bib.path, entry.line),
        });
      });
      nodes.push(item(path.basename(bib.path), { resourceUri: vscode.Uri.file(bib.path), description: `${bib.file.entries.length} entries`, children }));
    }
    const known = new Set(this.projects.bibEntries().map((e) => e.entry.key));
    const unresolved = [...cited].filter(([k]) => !known.has(k));
    if (unresolved.length && this.projects.bibs.size) {
      nodes.push(
        item('Citations without an entry', {
          iconPath: new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground')),
          description: String(unresolved.length),
          children: unresolved.map(([k, locs]) => item(k, { description: `${path.basename(locs[0].file)}:${locs[0].line + 1}`, command: openAt(locs[0].file, locs[0].line) })),
        }),
      );
    }
    return nodes;
  }
}

class LabelsTree extends SimpleTree {
  constructor(private readonly projects: ProjectManager) {
    super();
  }
  protected roots(): Node[] {
    const refs = new Map<string, number>();
    for (const f of this.projects.project?.files ?? []) for (const r of f.index.references) refs.set(r.name, (refs.get(r.name) ?? 0) + 1);
    const groups = new Map<string, Node[]>();
    for (const { label, file } of this.projects.allLabels()) {
      const kind = label.kind.replace(/\*$/, '');
      const count = refs.get(label.name) ?? 0;
      const list = groups.get(kind) ?? [];
      list.push(item(label.name, { description: `${count} ref${count === 1 ? '' : 's'}${label.caption ? ` · ${label.caption}` : ''}`, command: openAt(file, label.line) }));
      groups.set(kind, list);
    }
    return [...groups].sort().map(([kind, children]) => item(kind, { description: String(children.length), children }));
  }
}

class OutputsTree extends SimpleTree {
  constructor(private readonly projects: ProjectManager) {
    super();
  }
  protected roots(): Node[] {
    const out = this.projects.output();
    if (!out) return [];
    return listOutputs(out.outDir, out.jobName).map((file) => {
      const size = fs.statSync(file).size;
      return item(path.basename(file), {
        resourceUri: vscode.Uri.file(file),
        description: size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`,
        contextValue: 'outputFile',
        command: file.endsWith('.pdf') ? { command: 'latexdesk.viewPdf', title: 'View' } : file.endsWith('.gz') ? undefined : openAt(file, 0),
      });
    });
  }
}

export function registerViews(context: vscode.ExtensionContext, projects: ProjectManager, builds: BuildManager, health: BibHealth) {
  const build = new BuildTree(builds, projects, context);
  const structure = new StructureTree(projects);
  const files = new FilesTree(projects);
  const citations = new CitationsTree(projects, health);
  const labels = new LabelsTree(projects);
  const outputs = new OutputsTree(projects);
  const refreshProject = debounce(() => [structure, files, citations, labels, build].forEach((t) => t.refresh()), 150);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('latexdesk.build', build),
    vscode.window.registerTreeDataProvider('latexdesk.structure', structure),
    vscode.window.registerTreeDataProvider('latexdesk.files', files),
    vscode.window.registerTreeDataProvider('latexdesk.citations', citations),
    vscode.window.registerTreeDataProvider('latexdesk.labels', labels),
    vscode.window.registerTreeDataProvider('latexdesk.outputs', outputs),
    projects.onDidChange(refreshProject),
    health.onDidChange(() => citations.refresh()),
    builds.onDidChangeState((s) => {
      build.refresh();
      if (s.phase !== 'building') {
        outputs.refresh();
        structure.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('latexdesk') && build.refresh()),
    vscode.commands.registerCommand('latexdesk.refreshViews', async () => {
      await projects.refresh();
      [build, structure, files, citations, labels, outputs].forEach((t) => t.refresh());
    }),
    vscode.commands.registerCommand('latexdesk.structureFilter', async () => {
      const kinds: { label: string; value: StructureKind }[] = [
        { label: 'Sections', value: 'sections' },
        { label: 'Figures and tables', value: 'floats' },
        { label: 'Other labels (equations, theorems…)', value: 'labels' },
        { label: 'TODO / FIXME markers', value: 'todos' },
      ];
      const picks = await vscode.window.showQuickPick(
        kinds.map((k) => ({ ...k, picked: structure.filter.has(k.value) })),
        { canPickMany: true, placeHolder: 'Show in the structure view' },
      );
      if (!picks) return;
      structure.filter = new Set(picks.map((p) => p.value));
      structure.refresh();
    }),
  );
  return { refreshOutputs: () => outputs.refresh() };
}
