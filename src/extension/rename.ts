// Project-wide rename with VS Code's refactor preview: labels, citation keys (in .tex and .bib
// files), user-defined commands and environments. A new name that already exists is refused.
import * as vscode from 'vscode';
import * as fs from 'fs';
import latexData from '../../data/latex.json';
import { ProjectManager } from './projectManager';
import { argumentAt } from './texContext';
import { config, isBib } from './util';
import { findCommandUses, findEnvironmentUses, isCiteCommand } from '../core/texParser';
import { LineMap } from '../core/text';

type Target =
  | { kind: 'label'; name: string; range: vscode.Range }
  | { kind: 'citation'; name: string; range: vscode.Range }
  | { kind: 'command'; name: string; range: vscode.Range }
  | { kind: 'environment'; name: string; range: vscode.Range };

const BUILTIN_COMMANDS = new Set((latexData.commands as string[][]).map((c) => c[0]));
const BUILTIN_ENVIRONMENTS = new Set((latexData.environments as string[][]).map((e) => e[0]));

export function registerRename(context: vscode.ExtensionContext, projects: ProjectManager) {
  const provider: vscode.RenameProvider = {
    prepareRename(doc, pos) {
      const target = targetAt(doc, pos);
      if (!target) throw new Error('Rename works on labels, citation keys, and commands or environments defined in this project');
      return { range: target.range, placeholder: target.name };
    },
    provideRenameEdits(doc, pos, newName) {
      const target = targetAt(doc, pos);
      if (!target) return undefined;
      newName = newName.trim().replace(/^\\/, '');
      const problem = collision(target, newName);
      if (problem) throw new Error(problem);
      return buildEdit(target, newName);
    },
  };

  function targetAt(doc: vscode.TextDocument, pos: vscode.Position): Target | undefined {
    if (isBib(doc)) {
      const entry = projects.bibEntries().find((e) => e.bib.path === doc.fileName && doc.offsetAt(pos) >= e.entry.keyStart && doc.offsetAt(pos) <= e.entry.keyEnd)?.entry;
      return entry && { kind: 'citation', name: entry.key, range: new vscode.Range(doc.positionAt(entry.keyStart), doc.positionAt(entry.keyEnd)) };
    }
    const arg = argumentAt(doc, pos);
    if (arg) {
      const refs = new Set(config().get<string[]>('completion.refCommands') ?? []);
      if (arg.command === 'label' || refs.has(arg.command)) return { kind: 'label', name: arg.item, range: arg.itemRange };
      if (isCiteCommand(arg.command, config().get<string[]>('completion.citeCommands') ?? [])) return { kind: 'citation', name: arg.item, range: arg.itemRange };
      if (['begin', 'end', 'newenvironment', 'renewenvironment', 'newtheorem'].includes(arg.command) && isProjectEnvironment(arg.item)) {
        return { kind: 'environment', name: arg.item, range: arg.itemRange };
      }
    }
    const word = doc.getWordRangeAtPosition(pos, /\\[a-zA-Z@]+/);
    if (word) {
      const name = doc.getText(word).slice(1);
      if (isProjectCommand(name)) return { kind: 'command', name, range: word.with(word.start.translate(0, 1)) };
    }
    return undefined;
  }

  const files = () => projects.project?.files ?? [];
  const isProjectCommand = (name: string) => files().some((f) => f.index.commandDefs.some((d) => d.name === name));
  const isProjectEnvironment = (name: string) => files().some((f) => f.index.environmentDefs.some((d) => d.name === name));

  function collision(target: Target, newName: string): string | undefined {
    if (!newName || newName === target.name) return 'Enter a different name';
    switch (target.kind) {
      case 'label':
        if (/[\s{},\\%#]/.test(newName)) return 'A label cannot contain spaces, braces, commas, %, # or backslashes';
        if (projects.allLabels().some((l) => l.label.name === newName)) return `Label "${newName}" already exists`;
        return undefined;
      case 'citation':
        if (/[\s{},"#%'()=\\]/.test(newName)) return 'A citation key cannot contain spaces, braces, commas, quotes, #, %, parentheses, = or backslashes';
        // BibTeX compares keys without regard to case.
        if (projects.bibEntries().some((e) => e.entry.key.toLowerCase() === newName.toLowerCase())) return `Key "${newName}" already exists`;
        return undefined;
      case 'command':
        if (!/^[a-zA-Z]+$/.test(newName)) return 'A command name can only contain letters';
        if (isProjectCommand(newName) || BUILTIN_COMMANDS.has(newName)) return `\\${newName} already exists`;
        return undefined;
      case 'environment':
        if (!/^[a-zA-Z*]+$/.test(newName)) return 'An environment name can only contain letters and *';
        if (isProjectEnvironment(newName) || BUILTIN_ENVIRONMENTS.has(newName)) return `Environment "${newName}" already exists`;
        return undefined;
    }
  }

  function buildEdit(target: Target, newName: string): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    const label = `Rename ${target.kind} ${target.name} → ${newName}`;
    const replace = (file: string, offsets: number[], length: number, text: string) => {
      if (!offsets.length) return;
      const lines = lineMapFor(file);
      for (const offset of offsets) {
        const start = lines.positionAt(offset);
        const end = lines.positionAt(offset + length);
        edit.replace(vscode.Uri.file(file), new vscode.Range(start.line, start.character, end.line, end.character), text, { needsConfirmation: true, label });
      }
    };
    for (const f of files()) {
      const index = f.index;
      if (target.kind === 'label') {
        replace(f.path, [...index.labels, ...index.references].filter((x) => x.name === target.name).map((x) => x.offset), target.name.length, newName);
      } else if (target.kind === 'citation') {
        replace(f.path, index.citations.filter((c) => c.key === target.name).map((c) => c.offset), target.name.length, newName);
      } else if (target.kind === 'command') {
        replace(f.path, findCommandUses(textOf(f.path), target.name), target.name.length + 1, '\\' + newName);
      } else {
        replace(f.path, findEnvironmentUses(textOf(f.path), target.name), target.name.length, newName);
      }
    }
    if (target.kind === 'citation') {
      for (const { entry, bib } of projects.bibEntries()) {
        if (entry.key === target.name) replace(bib.path, [entry.keyStart], entry.keyEnd - entry.keyStart, newName);
      }
    }
    return edit;
  }

  context.subscriptions.push(vscode.languages.registerRenameProvider([{ language: 'latex' }, { language: 'tex' }, { language: 'bibtex' }], provider));
}

/** Text of a file as VS Code sees it (unsaved changes included). */
function textOf(file: string): string {
  return vscode.workspace.textDocuments.find((d) => d.fileName === file)?.getText() ?? fs.readFileSync(file, 'utf8');
}

function lineMapFor(file: string): { positionAt(offset: number): { line: number; character: number } } {
  const open = vscode.workspace.textDocuments.find((d) => d.fileName === file);
  if (open) return open;
  const map = new LineMap(fs.readFileSync(file, 'utf8'));
  return { positionAt: (offset) => map.position(offset) };
}
