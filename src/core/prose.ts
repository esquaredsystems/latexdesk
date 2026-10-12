// Finds the prose words of a LaTeX file for spell checking: commands, math, comments, verbatim,
// labels, citation keys, file names and URLs are skipped.
import { maskNonCode } from './text';

export interface ProseWord {
  word: string;
  offset: number;
}

/** Commands whose (first) argument is not prose. */
const NON_PROSE_ARGS = new Set([
  'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref',
  'cite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear', 'autocite', 'parencite', 'textcite', 'footcite', 'nocite', 'Cite', 'Citep', 'Citet',
  'input', 'include', 'includeonly', 'subfile', 'import', 'subimport', 'includegraphics', 'graphicspath',
  'usepackage', 'RequirePackage', 'documentclass', 'bibliography', 'bibliographystyle', 'addbibresource',
  'begin', 'end', 'url', 'href', 'hypersetup', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'pagestyle', 'thispagestyle',
  'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'newtheorem', 'DeclareMathOperator',
  'color', 'textcolor', 'pagecolor', 'definecolor', 'selectlanguage', 'foreignlanguage', 'hyphenation', 'lstinline', 'verb',
]);

const MATH_ENVS = /\\begin\{(equation|align|alignat|gather|multline|flalign|eqnarray|math|displaymath|split|IEEEeqnarray)(\*?)\}[\s\S]*?\\end\{\1\2\}/g;

/** Latin abbreviations and prefixes that are normal in academic writing but missing from dictionaries. */
export const ACADEMIC_WORDS = ['et', 'al', 'etc', 'cf', 'eg', 'ie', 'viz', 'vs', 'pre', 'non', 'sub', 'multi', 'co', 're'];

/** `from` skips everything before that offset (the preamble of a root document). */
export function proseWords(text: string, extraSkip: string[] = [], from = 0): ProseWord[] {
  const chars = maskNonCode(text).split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < chars.length; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  };
  let masked = chars.join('');

  // Math: environments first, then $$..$$, $..$, \[..\], \(..\).
  for (const m of masked.matchAll(MATH_ENVS)) blank(m.index!, m.index! + m[0].length);
  masked = chars.join('');
  for (const m of masked.matchAll(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g)) blank(m.index!, m.index! + m[0].length);
  masked = chars.join('');

  // URLs written as plain text.
  for (const m of masked.matchAll(/\b(?:https?|ftp):\/\/\S+/g)) blank(m.index!, m.index! + m[0].length);

  // Words written with TeX accents or discretionary hyphens (M\"uller, hy\-phen) are skipped whole:
  // splitting them would report the fragments as misspellings.
  for (const m of masked.matchAll(/[A-Za-z]*(?:\\(?:['"^`~=.-]|[uvHtcdbr](?=\{))\{?\\?[A-Za-z]?\}?[A-Za-z]*)+/g)) blank(m.index!, m.index! + m[0].length);
  masked = chars.join('');

  // Commands: the name always, plus optional arguments and the first argument of non-prose commands.
  const skip = new Set([...NON_PROSE_ARGS, ...extraSkip]);
  masked = chars.join('');
  for (const m of masked.matchAll(/\\([a-zA-Z@]+)\*?/g)) {
    let pos = m.index! + m[0].length;
    blank(m.index!, pos);
    // Optional arguments [..] directly after a command are almost never prose (placement, widths, options).
    while (masked[pos] === '[') {
      const close = masked.indexOf(']', pos);
      if (close < 0) break;
      blank(pos, close + 1);
      pos = close + 1;
    }
    if (skip.has(m[1]) && masked[pos] === '{') {
      const close = matchingBrace(masked, pos);
      blank(pos, close + 1);
      // \href{url}{text}: only the url is skipped; \begin{tabular}{lcr}: the column spec too.
      if (m[1] === 'begin' && masked[close + 1] === '{') blank(close + 1, matchingBrace(masked, close + 1) + 1);
    }
  }

  const words: ProseWord[] = [];
  const result = chars.join('');
  for (const m of result.matchAll(/[A-Za-zÀ-ɏ](?:[A-Za-zÀ-ɏ']*[A-Za-zÀ-ɏ])?/g)) {
    const word = m[0];
    // Skip single letters, acronyms (all capitals) and words glued to digits or underscores.
    if (word.length < 2 || word === word.toUpperCase()) continue;
    const before = result[m.index! - 1];
    const after = result[m.index! + word.length];
    if (/[\d_@]/.test(before ?? '') || /[\d_@]/.test(after ?? '')) continue;
    if (m.index! < from) continue;
    words.push({ word, offset: m.index! });
  }
  return words;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length;
}
