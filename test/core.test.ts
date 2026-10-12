import { describe, expect, it } from 'vitest';
import { parseTex } from '../src/core/texParser';
import { parseBib } from '../src/core/bibParser';
import { scanBib } from '../src/core/bibScanner';
import { parseLatexLog, parseBlg, missingCitationKeys } from '../src/core/logParser';
import { countWords } from '../src/core/wordCount';
import { explain } from '../src/core/explain';
import { maskNonCode } from '../src/core/text';

describe('texParser', () => {
  const tex = String.raw`% !TEX program = xelatex
\documentclass[a4paper]{article}
\usepackage{amsmath,graphicx}
\graphicspath{{Figs/}{img/}}
\newcommand{\R}{\mathbb{R}}
\newcommand\vect[1]{\mathbf{#1}}
\begin{document}
\chapter{Intro}\label{ch:intro}
See \ref{fig:a} and \cref{eq:1,eq:2}. % \ref{commented}
As shown by~\citep[p.~3]{knuth1984, lamport94}.
%\include{dedication}
\include{chapter-one}
\input{sections/two.tex}
\begin{figure}
  \includegraphics[width=\linewidth]{setup}
  \caption{The \emph{setup}.}\label{fig:a}
\end{figure}
\begin{equation}x=1\label{eq:1}\end{equation}
\begin{verbatim}
\section{not a section}
\end{verbatim}
\section*{Methods}
\bibliography{refs,more}
\begin{itemize}
\end{document}
`;
  const index = parseTex(tex);

  it('finds sections, skipping verbatim', () => {
    expect(index.sections.map((s) => [s.command, s.title, s.line])).toEqual([
      ['chapter', 'Intro', 7],
      ['section', 'Methods', 21],
    ]);
  });
  it('finds labels with their environment and caption', () => {
    expect(index.labels.map((l) => [l.name, l.kind])).toEqual([
      ['ch:intro', 'section'],
      ['fig:a', 'figure'],
      ['eq:1', 'equation'],
    ]);
    expect(index.labels[1].caption).toBe('The setup.');
  });
  it('finds references and citations but not commented ones', () => {
    expect(index.references.map((r) => r.name)).toEqual(['fig:a', 'eq:1', 'eq:2']);
    expect(index.citations.map((c) => c.key)).toEqual(['knuth1984', 'lamport94']);
  });
  it('finds includes, bibliographies, graphics and definitions', () => {
    expect(index.includes.map((i) => [i.kind, i.path])).toEqual([
      ['include', 'chapter-one'],
      ['input', 'sections/two.tex'],
    ]);
    expect(index.bibResources.map((b) => b.path)).toEqual(['refs', 'more']);
    expect(index.graphics.map((g) => g.path)).toEqual(['setup']);
    expect(index.graphicsPaths).toEqual(['Figs/', 'img/']);
    expect(index.commandDefs.map((c) => [c.name, c.argCount])).toEqual([
      ['R', 0],
      ['vect', 1],
    ]);
    expect(index.packages.map((p) => p.name)).toEqual(['amsmath', 'graphicx']);
  });
  it('reads magic comments and the document class', () => {
    expect(index.magic.program).toBe('xelatex');
    expect(index.documentClass?.name).toBe('article');
    expect(index.hasBeginDocument).toBe(true);
  });
  it('reports unclosed environments', () => {
    expect(index.unbalancedEnvironments.map((u) => [u.name, u.problem])).toEqual([['itemize', 'mismatch']]);
  });
  it('masks comments without moving offsets', () => {
    const s = 'a % b\n\\% c % d';
    const masked = maskNonCode(s);
    expect(masked.length).toBe(s.length);
    expect(masked).toBe('a    \n\\% c    ');
  });
});

describe('bib parser and scanner', () => {
  const bib = String.raw`@string{jfm = "J. Field Methods"}
% bib-ignore: missing-required
@article{ignored, title = {No author}}

@article{jones2021,
  author = {Jones, A. and Lee, K. et al.},
  title = {Robust estimation in multi-site trials},
  year = 2021,
  pages = {12-18},
  doi = {https://doi.org/10.1002/sim.8812},
}
@book{knuth1984,
  author = {Knuth, D. E.},
  title = {The {\TeX}book},
  publisher = {Addison-Wesley},
  year = {1984},
  isbn = {0-201-13447-0},
  titel = {typo},
}
@inproceedings{Jones2021, author={X}, title={Y & Z}, booktitle=jfm, year={20xx}}
@misc{broken, title = {unclosed
@article{after, author={A}, title={B}, journal=nojournal, year=2020, doi={10.1/x}}
@article{dup1, author={Smith, J.}, title={Same Work}, journal={J}, year=2019, doi={10.1000/abc}}
@article{dup2, author={Smith, J.}, title={Same work.}, journal={J}, year=2019, doi={10.1000/ABC}}
`;
  const file = parseBib(bib);
  const result = scanBib(file, bib, { dialect: 'bibtex', profile: 'standard', currentYear: 2026, citedKeys: new Set(['jones2021']) });
  const codes = (key: string) => result.findings.filter((f) => f.entryKey === key).map((f) => f.code);

  it('parses entries and recovers after a broken one', () => {
    expect(file.entries.map((e) => e.key)).toEqual(['ignored', 'jones2021', 'knuth1984', 'Jones2021', 'broken', 'after', 'dup1', 'dup2']);
    expect(file.strings.get('jfm')?.value).toBe('J. Field Methods');
    expect(result.findings.some((f) => f.code === 'bib/syntax')).toBe(true);
  });
  it('keeps exact offsets for values', () => {
    const pages = file.entries[1].fields.find((f) => f.name === 'pages')!;
    expect(bib.slice(pages.valueStart, pages.valueEnd)).toBe('{12-18}');
  });
  it('honours bib-ignore comments', () => {
    expect(codes('ignored')).not.toContain('bib/missing-required');
  });
  it('reports value problems', () => {
    const c = codes('jones2021');
    expect(c).toContain('bib/missing-required'); // journal
    expect(c).toContain('bib/et-al');
    expect(c).toContain('bib/page-range');
    expect(c).toContain('bib/doi-url');
    expect(c).not.toContain('bib/uncited');
  });
  it('reports structural problems', () => {
    expect(codes('Jones2021')).toEqual(expect.arrayContaining(['bib/duplicate-key', 'bib/unescaped-char', 'bib/invalid-year']));
    expect(codes('knuth1984')).toContain('bib/unknown-field');
    expect(codes('knuth1984')).not.toContain('bib/invalid-isbn');
    expect(codes('after')).toContain('bib/undefined-string');
    expect(codes('knuth1984')).toContain('bib/uncited');
  });
  it('finds duplicate works by DOI', () => {
    expect(result.duplicateGroups).toContainEqual({ reason: 'same DOI', possible: false, keys: ['dup1', 'dup2'] });
  });
  it('scores complete entries higher', () => {
    const score = (key: string) => [...result.entries.values()].find((r) => r.key === key)!.score;
    expect(score('knuth1984')).toBeGreaterThan(score('jones2021'));
  });
  it('produces fixes with exact replacement ranges', () => {
    const fix = result.findings.find((f) => f.code === 'bib/page-range')!.fix!;
    expect(fix.kind).toBe('replace');
    if (fix.kind === 'replace') expect(bib.slice(fix.start, fix.end)).toBe('12-18');
  });
});

describe('log parser', () => {
  const log = [
    'This is pdfTeX, Version 3.141592653-2.6-1.40.22',
    '(./main.tex',
    'LaTeX2e <2021-11-15>',
    '(/usr/share/texlive/texmf-dist/tex/latex/base/book.cls',
    'Document Class: book 2021/10/04 v1.4n Standard LaTeX document class',
    ')',
    '(./chapter-intro.tex',
    '! Undefined control sequence.',
    'l.12 Some text \\foo',
    '                   bar',
    '',
    // TeX wraps this line at 79 characters.
    'Package natbib Warning: Citation `smith2019\' on page 3 undefined on input line ',
    '42.',
    '',
    ')',
    'Overfull \\hbox (12.0pt too wide) in paragraph at lines 20--22',
    'LaTeX Warning: Reference `fig:x\' on page 2 undefined on input line 30.',
    '',
    'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.',
    ')',
    'Output written on main.pdf (254 pages, 1234 bytes).',
  ].join('\n');
  const summary = parseLatexLog(log);

  it('maps errors to the file on the stack', () => {
    const err = summary.entries.find((e) => e.severity === 'error')!;
    expect(err).toMatchObject({ file: './chapter-intro.tex', line: 12 });
    expect(err.message).toContain('\\foo');
  });
  it('joins multi-line package warnings', () => {
    const w = summary.entries.find((e) => e.message.includes('smith2019'))!;
    expect(w.line).toBe(42);
  });
  it('tracks the file stack after a file closes', () => {
    const w = summary.entries.find((e) => e.message.includes('fig:x'))!;
    expect(w.file).toBe('./main.tex');
    expect(summary.entries.find((e) => e.severity === 'badbox')?.line).toBe(20);
  });
  it('reads the summary', () => {
    expect(summary.rerunNeeded).toBe(true);
    expect(summary.undefinedReferences).toBe(true);
    expect(summary.pages).toBe(254);
    expect(missingCitationKeys(summary.entries)).toEqual(['smith2019']);
  });
  it('parses bibtex logs', () => {
    const blg = 'Warning--I didn\'t find a database entry for "smith2019"\nWarning--empty journal in jones2021\nI was expecting a `,\' or a `}\'---line 12 of file refs.bib';
    const entries = parseBlg(blg);
    expect(entries.map((e) => e.severity)).toEqual(['warning', 'warning', 'error']);
    expect(entries[2]).toMatchObject({ file: 'refs.bib', line: 12 });
  });
});

describe('word count and explanations', () => {
  it('counts prose only', () => {
    const t = String.raw`\documentclass{article}\begin{document}
Hello \textbf{brave} new world~\cite{x}. % not this
$a + b$ and \label{y}
\begin{equation} x = y \end{equation}
\end{document}`;
    expect(countWords(t)).toBe(5);
  });
  it('explains known errors and returns nothing for unknown ones', () => {
    expect(explain('Undefined control sequence \\foo')?.id).toBe('undefined-control-sequence');
    expect(explain('Something odd happened')).toBeUndefined();
  });
});
