// Extracts the structure of one LaTeX file: sections, labels, citations, includes, etc.
// The parser never throws; malformed input just produces fewer results.
import { LineMap, maskNonCode, readArgs, readGroup, splitList } from './text';

export const SECTION_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

export interface Located {
  line: number;
  offset: number;
}

export interface Section extends Located {
  level: number;
  command: string;
  title: string;
  starred: boolean;
}

export interface Label extends Located {
  name: string;
  /** Innermost environment (figure, equation, ...) or "section". */
  kind: string;
  /** Caption or section title near the label, when known. */
  caption?: string;
}

export interface Citation extends Located {
  command: string;
  key: string;
}

export interface Reference extends Located {
  command: string;
  name: string;
}

export type IncludeKind = 'input' | 'include' | 'subfile' | 'import';

export interface Include extends Located {
  kind: IncludeKind;
  /** Path as written in the source (no extension added). */
  path: string;
  /** For \import / \subimport: the directory argument. */
  dir?: string;
}

export interface Graphic extends Located {
  path: string;
}

export interface CommandDef extends Located {
  name: string;
  argCount: number;
  body: string;
}

export interface EnvironmentBlock {
  name: string;
  beginLine: number;
  beginOffset: number;
  endLine?: number;
  endOffset?: number;
}

export interface Todo extends Located {
  tag: string;
  text: string;
}

export interface TexFileIndex {
  sections: Section[];
  labels: Label[];
  citations: Citation[];
  references: Reference[];
  includes: Include[];
  bibResources: (Located & { path: string })[];
  graphics: Graphic[];
  graphicsPaths: string[];
  commandDefs: CommandDef[];
  environmentDefs: CommandDef[];
  environments: EnvironmentBlock[];
  /** \begin without a matching \end, or the reverse. */
  unbalancedEnvironments: (Located & { name: string; problem: 'unclosed' | 'unopened' | 'mismatch'; expected?: string })[];
  packages: (Located & { name: string; options: string })[];
  documentClass?: { name: string; options: string; line: number };
  hasBeginDocument: boolean;
  /** Offset of \begin{document}, when the file has one. */
  beginDocumentOffset?: number;
  magic: Record<string, string>;
  todos: Todo[];
  usedCommands: Set<string>;
}

const CITE_PATTERN = /^(no)?cite|^[Cc]ite|cite$|^(paren|text|foot|auto|super|smart|full)cite/i;
const REF_COMMANDS = new Set(['ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref', 'Vref', 'labelcref', 'crefrange', 'Crefrange', 'subref']);

export function isCiteCommand(name: string, extra: string[] = []): boolean {
  return extra.includes(name) || CITE_PATTERN.test(name);
}

/** Reads `% !TEX key = value` (and `% !BIB key = value`) comments from the top of a file. */
export function parseMagicComments(text: string): Record<string, string> {
  const magic: Record<string, string> = {};
  const lines = text.split(/\r?\n/, 40);
  for (const line of lines) {
    const m = /^\s*%\s*!\s*(TEX|TeX|tex|BIB|bib|LS)\s+(?:TS-)?([\w-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (m) {
      const prefix = m[1].toLowerCase() === 'bib' ? 'bib.' : '';
      magic[prefix + m[2].toLowerCase()] = m[3];
    }
  }
  return magic;
}

export function parseTex(text: string, options: { citeCommands?: string[]; refCommands?: string[] } = {}): TexFileIndex {
  const masked = maskNonCode(text);
  const lines = new LineMap(text);
  const refCommands = new Set([...REF_COMMANDS, ...(options.refCommands ?? [])]);

  const result: TexFileIndex = {
    sections: [],
    labels: [],
    citations: [],
    references: [],
    includes: [],
    bibResources: [],
    graphics: [],
    graphicsPaths: [],
    commandDefs: [],
    environmentDefs: [],
    environments: [],
    unbalancedEnvironments: [],
    packages: [],
    hasBeginDocument: false,
    magic: parseMagicComments(text),
    todos: [],
    usedCommands: new Set(),
  };

  const envStack: EnvironmentBlock[] = [];
  let lastCaption: string | undefined;
  const at = (offset: number) => ({ offset, line: lines.lineAt(offset) });

  const commandPattern = /\\([a-zA-Z@]+)(\*?)/g;
  let m: RegExpExecArray | null;
  while ((m = commandPattern.exec(masked))) {
    const name = m[1];
    const starred = m[2] === '*';
    const after = m.index + m[0].length;
    result.usedCommands.add(name);

    if (name in SECTION_LEVELS) {
      const { args } = readArgs(masked, after, 1);
      if (args[0]) {
        result.sections.push({
          ...at(m.index),
          level: SECTION_LEVELS[name],
          command: name,
          title: cleanTitle(text.slice(args[0].start, args[0].end - 1)),
          starred,
        });
        lastCaption = undefined;
      }
      continue;
    }

    switch (name) {
      case 'begin':
      case 'end': {
        const g = readGroup(masked, after);
        if (!g) break;
        const env = g.content.trim();
        if (name === 'begin') {
          if (env === 'document') {
            result.hasBeginDocument = true;
            result.beginDocumentOffset ??= m.index;
          }
          const block: EnvironmentBlock = { name: env, beginLine: lines.lineAt(m.index), beginOffset: m.index };
          envStack.push(block);
          result.environments.push(block);
        } else {
          closeEnvironment(env, m.index);
        }
        break;
      }
      case 'label': {
        const g = readGroup(masked, after);
        if (g) {
          const inner = envStack.filter((e) => e.name !== 'document').pop();
          const kind = inner ? inner.name : 'section';
          const lastSection = result.sections[result.sections.length - 1];
          result.labels.push({
            ...at(g.start),
            name: g.content.trim(),
            kind,
            caption: kind === 'section' ? lastSection?.title : lastCaption,
          });
        }
        break;
      }
      case 'caption': {
        const { args } = readArgs(masked, after, 1);
        if (args[0]) lastCaption = cleanTitle(text.slice(args[0].start, args[0].end - 1));
        break;
      }
      case 'input':
      case 'include':
      case 'subfile':
      case 'InputIfFileExists':
      case 'includeonly': {
        if (name === 'includeonly') break;
        const g = readGroup(masked, after);
        if (g && g.content.trim()) {
          const kind: IncludeKind = name === 'include' ? 'include' : name === 'subfile' ? 'subfile' : 'input';
          result.includes.push({ ...at(g.start), kind, path: g.content.trim() });
        }
        break;
      }
      case 'import':
      case 'subimport':
      case 'inputfrom':
      case 'subinputfrom':
      case 'includefrom':
      case 'subincludefrom': {
        const { args } = readArgs(masked, after, 2, false);
        if (args.length === 2) {
          result.includes.push({ ...at(args[1].start), kind: 'import', dir: args[0].content.trim(), path: args[1].content.trim() });
        }
        break;
      }
      case 'bibliography':
      case 'addbibresource':
      case 'addglobalbib':
      case 'addsectionbib': {
        const { args } = readArgs(masked, after, 1);
        if (args[0]) {
          for (const item of splitList(args[0])) result.bibResources.push({ ...at(item.offset), path: item.value });
        }
        break;
      }
      case 'includegraphics': {
        const { args } = readArgs(masked, after, 1);
        if (args[0]) result.graphics.push({ ...at(args[0].start), path: args[0].content.trim() });
        break;
      }
      case 'graphicspath': {
        const outer = readGroup(masked, after);
        if (outer) {
          const inner = /\{([^{}]*)\}/g;
          let p: RegExpExecArray | null;
          while ((p = inner.exec(outer.content))) result.graphicsPaths.push(p[1]);
        }
        break;
      }
      case 'usepackage':
      case 'RequirePackage': {
        const { opts, args } = readArgs(masked, after, 1);
        if (args[0]) {
          for (const item of splitList(args[0])) {
            result.packages.push({ ...at(item.offset), name: item.value, options: opts[0]?.content ?? '' });
          }
        }
        break;
      }
      case 'documentclass': {
        const { opts, args } = readArgs(masked, after, 1);
        if (args[0]) {
          result.documentClass = { name: args[0].content.trim(), options: opts[0]?.content ?? '', line: lines.lineAt(m.index) };
        }
        break;
      }
      case 'newcommand':
      case 'renewcommand':
      case 'providecommand':
      case 'DeclareMathOperator':
      case 'DeclareRobustCommand':
      case 'NewDocumentCommand': {
        // \newcommand{\foo}[2][default]{body}  or  \newcommand\foo{body}
        let nameEnd = after;
        let cmdName: string | undefined;
        const braced = readGroup(masked, after);
        if (braced) {
          cmdName = braced.content.trim();
          nameEnd = braced.end;
        } else {
          const direct = /^\s*(\\[a-zA-Z@]+)/.exec(masked.slice(after, after + 80));
          if (direct) {
            cmdName = direct[1];
            nameEnd = after + direct[0].length;
          }
        }
        if (!cmdName?.startsWith('\\')) break;
        const { opts, args } = readArgs(masked, nameEnd, 1);
        const argCount = opts[0] ? parseInt(opts[0].content, 10) || 0 : 0;
        result.commandDefs.push({
          ...at(m.index),
          name: cmdName.slice(1),
          argCount,
          body: args[0] ? text.slice(args[0].start, args[0].end - 1) : '',
        });
        break;
      }
      case 'def':
      case 'gdef': {
        const d = /^\s*\\([a-zA-Z@]+)/.exec(masked.slice(after, after + 80));
        if (d) result.commandDefs.push({ ...at(m.index), name: d[1], argCount: 0, body: '' });
        break;
      }
      case 'newenvironment':
      case 'renewenvironment':
      case 'newtheorem':
      case 'NewDocumentEnvironment': {
        const g = readGroup(masked, after);
        if (g) result.environmentDefs.push({ ...at(m.index), name: g.content.trim(), argCount: 0, body: '' });
        break;
      }
      case 'todo': {
        const { args } = readArgs(masked, after, 1);
        if (args[0]) result.todos.push({ ...at(m.index), tag: 'TODO', text: cleanTitle(args[0].content) });
        break;
      }
      default: {
        if (refCommands.has(name)) {
          const { args } = readArgs(masked, after, name.endsWith('range') ? 2 : 1);
          for (const arg of args) {
            for (const item of splitList(arg)) result.references.push({ ...at(item.offset), command: name, name: item.value });
          }
        } else if (isCiteCommand(name, options.citeCommands)) {
          // \cite[pre][post]{a,b}; biblatex multicite forms like \cites{a}{b} are handled by reading repeatedly.
          let pos = after;
          for (let n = 0; n < 10; n++) {
            const { args, end } = readArgs(masked, pos, 1);
            if (!args[0]) break;
            for (const item of splitList(args[0])) {
              if (item.value !== '*') result.citations.push({ ...at(item.offset), command: name, key: item.value });
            }
            pos = end;
            if (!name.endsWith('s')) break;
          }
        }
      }
    }
  }

  for (const open of envStack) {
    result.unbalancedEnvironments.push({ name: open.name, problem: 'unclosed', line: open.beginLine, offset: open.beginOffset });
  }

  // TODO / FIXME markers live in comments, so they are read from the original text.
  const todoPattern = /%+\s*(TODO|FIXME|NOTE|XXX)\b:?\s*(.*)$/gm;
  while ((m = todoPattern.exec(text))) {
    result.todos.push({ ...at(m.index), tag: m[1], text: m[2].trim() });
  }
  result.todos.sort((a, b) => a.offset - b.offset);
  return result;

  function closeEnvironment(env: string, offset: number) {
    // Find the nearest open environment with this name.
    for (let i = envStack.length - 1; i >= 0; i--) {
      if (envStack[i].name === env) {
        // Anything opened after it was never closed.
        for (let j = envStack.length - 1; j > i; j--) {
          const open = envStack[j];
          result.unbalancedEnvironments.push({ name: open.name, problem: 'mismatch', expected: env, line: open.beginLine, offset: open.beginOffset });
        }
        const block = envStack[i];
        block.endOffset = offset;
        block.endLine = lines.lineAt(offset);
        envStack.length = i;
        return;
      }
    }
    result.unbalancedEnvironments.push({ name: env, problem: 'unopened', line: lines.lineAt(offset), offset });
  }
}

/** Turns `\textbf{Intro}~and \emph{more}` into `Intro and more` for display. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/\\(?:label|index)\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Offsets of the backslash of every `\name` use (not `\namex`), outside comments and verbatim. */
export function findCommandUses(text: string, name: string): number[] {
  const masked = maskNonCode(text);
  const re = new RegExp(`\\\\${escapeRegExp(name)}(?![a-zA-Z@])`, 'g');
  return [...masked.matchAll(re)].map((m) => m.index!);
}

/** Offsets of an environment name inside \begin{..}, \end{..} and its definition, outside comments. */
export function findEnvironmentUses(text: string, name: string): number[] {
  const masked = maskNonCode(text);
  const re = new RegExp(`\\\\(?:begin|end|newenvironment|renewenvironment|newtheorem|NewDocumentEnvironment)\\*?\\s*\\{\\s*(${escapeRegExp(name)})\\s*\\}`, 'g');
  return [...masked.matchAll(re)].map((m) => m.index! + m[0].indexOf(m[1], m[0].indexOf('{')));
}
