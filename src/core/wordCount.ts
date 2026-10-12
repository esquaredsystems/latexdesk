// Approximate word count of LaTeX prose. Commands, math, comments and
// non-prose arguments (labels, citations, file names) are not counted.
import { maskNonCode } from './text';

const NON_PROSE_ARGS = [
  'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'cite', 'citep', 'citet', 'nocite', 'autocite',
  'parencite', 'textcite', 'includegraphics', 'input', 'include', 'subfile', 'bibliography', 'bibliographystyle',
  'addbibresource', 'usepackage', 'documentclass', 'begin', 'end', 'graphicspath', 'url', 'href', 'hypersetup',
  'newcommand', 'renewcommand', 'setlength', 'addtocounter', 'setcounter', 'pagestyle', 'thispagestyle',
  'vspace', 'hspace', 'index', 'nomenclature',
];
const MATH_ENVS = ['equation', 'equation\\*', 'align', 'align\\*', 'gather', 'gather\\*', 'multline', 'multline\\*', 'eqnarray', 'eqnarray\\*', 'displaymath', 'math', 'tikzpicture', 'tabular'];

export interface WordCountOptions {
  /** Only count inside \begin{document} ... \end{document} when the file has one. */
  documentOnly?: boolean;
}

export function countWords(text: string, options: WordCountOptions = { documentOnly: true }): number {
  let t = maskNonCode(text);
  if (options.documentOnly) {
    const begin = t.indexOf('\\begin{document}');
    if (begin >= 0) {
      const end = t.indexOf('\\end{document}');
      t = t.slice(begin + 16, end < 0 ? undefined : end);
    }
  }
  for (const env of MATH_ENVS) {
    t = t.replace(new RegExp(`\\\\begin\\{${env}\\}[\\s\\S]*?\\\\end\\{${env}\\}`, 'g'), ' ');
  }
  t = t
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/(^|[^\\])\$[^$]*\$/g, '$1 ');
  const argPattern = new RegExp(`\\\\(?:${NON_PROSE_ARGS.join('|')})\\*?(\\[[^\\]]*\\]|\\{[^{}]*\\})*`, 'g');
  t = t.replace(argPattern, ' ');
  t = t.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ').replace(/\\./g, ' ');
  t = t.replace(/[{}~&_^#]/g, ' ');
  const words = t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}
