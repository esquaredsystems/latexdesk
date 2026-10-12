# LaTeX Studio

A LaTeX extension for Visual Studio Code: build with your installed TeX distribution, read the
PDF beside the source with two-way SyncTeX, and get completion, an outline, live checks, spelling
and a bibliography checker that tells you whether your `.bib` file is ready to submit.

Everything works offline. LaTeX Studio never sends your documents anywhere ([privacy](docs/privacy.md)).

## Requirements

- VS Code 1.85 or newer.
- A TeX distribution for building: [TeX Live](https://tug.org/texlive/) (Linux, Windows),
  [MacTeX](https://tug.org/mactex/) (macOS) or [MiKTeX](https://miktex.org/) (Windows).
  `latexmk` is used when it is installed (it is in all three); otherwise LaTeX Studio runs
  `pdflatex`, `bibtex` and `makeindex` itself.
- Optional: `latexindent` or `tex-fmt` (formatting), `latexdiff` (change PDFs), `texcount`
  (a second word count), `synctex` (not needed; LaTeX Studio reads SyncTeX files itself).

Run **LaTeX Studio: Check LaTeX Tools** to see what was found. Executable paths can be set
explicitly with `latexstudio.tools.paths`. Editing, completion and checks work without any TeX
installation; only building needs one.

## Getting started

1. Open the folder that contains your `.tex` files.
2. Open the main file (the one with `\documentclass`) and press **Ctrl+Alt+B** (**Cmd+Alt+B** on
   macOS). The PDF opens beside the source after the first successful build.
3. Save to rebuild (`latexstudio.build.autoBuild`). **Ctrl/Cmd-click** in the PDF jumps to the
   source; **Ctrl+Alt+J** jumps from the cursor to the PDF.

LaTeX Studio finds the root document by itself: a `% !TEX root = ../main.tex` comment wins, then
a file that `\documentclass`es and includes the file you are editing. When several documents
qualify it asks once; **Select Root Document** changes the choice later.

## The editor window

LaTeX files get editing controls around the editor:

- **Title bar of the editor:** Undo, Redo, Compile, Build & View, View Log, **Part ▾** (`\part` …
  `\subparagraph`) and **Label ▾** (`\label`, `\ref`, `\eqref`, `\pageref`, `\cref`, `\cite`, which
  open the completion list of your labels and keys). Cut, Copy, Paste, the table buttons,
  Highlight and Comment are under "…" there, because VS Code shows at most about seven extension
  buttons in an editor's title bar.
- **LaTeX Tools mini bar** (left, opens with the first `.tex` file): the full toolbar (undo, redo,
  cut, copy, paste, compile, build & view, log, part, label, add/delete table row and column,
  highlight, comment), then **Format** (bold, italic, underline, strikeout, align left / centre /
  right / justify, larger, smaller), **Equation** (inline, display, numbered, align, fraction,
  root, super/subscript, sum, integral, limit, `\left( \right)`, `\text`, cases, matrix of any
  size) and **Symbols** (by category, or search by name or by pasting the character).

Formatting buttons act on the selection (or the word under the cursor) and work as toggles:
Bold on `\textbf{word}` removes it again; Larger and Smaller step through `\small` … `\Huge`;
choosing the same alignment twice removes the environment. Table buttons work on the table under
the cursor. When a button needs a package the document does not load (`ulem` for strikeout,
`soul` for highlight, `ragged2e` for justify), you are offered the `\usepackage` line.
Turn the controls off with `latexstudio.toolbar.enabled` and `latexstudio.toolbar.showMiniBar`.

## Features

| Area | What you get |
|---|---|
| Build | Recipes (latexmk, pdflatex → bibtex → makeindex, XeLaTeX, LuaLaTeX, Tectonic, your own), magic comments `% !TEX program` / `% !LS recipe`, build on save, stop, clean, separate output folder, extra passes only when needed |
| Fast preview | A build with draft images in `.latexstudio/fast`, clearly labelled and never used for export. It helps when figures are slow to include (large PDF/EPS, TikZ); for PNG-heavy documents use partial builds ([measurements](docs/performance.md)) |
| Partial build | "Build This Chapter Only" for files loaded with `\include`, in `.latexstudio/partial`, using `\includeonly` without touching your sources |
| Problems | LaTeX, BibTeX and Biber messages in the Problems view with file and line, a log viewer with the file stack, and plain-language explanations of common errors |
| PDF viewer | pdf.js viewer: zoom, fit, layouts, search, outline, links, dark pages; keeps your place across rebuilds and never shows a half-written PDF |
| SyncTeX | Forward and reverse search, read in-process (no external tool needed), works with included files, CRLF files and output folders |
| Language | Completion for commands, environments, citation keys, labels, packages and files; hovers for citations, labels, images and math (rendered with MathJax, approximate); go to definition; find references; rename for labels, citation keys, your own commands and environments, with a preview |
| Outline | Structure, Files, Bibliography, Labels and Output Files views, folding, document links |
| Editing | Toolbars (above), snippets, insert/wrap/close/rename environments, `\[…\]` ↔ `equation`, automatic `\item` on Enter, table wizard (also from spreadsheet data or CSV) |
| Checks | Unmatched environments, duplicate labels, undefined references and citations, obsolete commands, as you type |
| Spelling | Offline spell checking of prose only (commands, math, labels, citations, comments and the preamble are skipped), US and UK English included, project and personal dictionaries |
| Bibliography | Checker with stable rule codes, completeness score per entry, quick fixes, Bib Manager (table, triage queue, health report), entry form beside the text, citation search, and a command-line checker for CI |
| History | Snapshots of your sources after each successful build, labelled versions, diff and restore, and a latexdiff PDF against any snapshot |
| Export | Export for submission (arXiv, journal, full project ZIP): only the files used, optional flattening and comment stripping, `.bbl` included, arXiv checks, then a test compile of the exported copy |
| Dashboard | Build state, issues, bibliography health, words, TODOs and blockers at a glance |

Word counts and math previews are approximations and say so.

## Keyboard shortcuts

| Command | Windows / Linux | macOS |
|---|---|---|
| Build LaTeX Project | Ctrl+Alt+B | Cmd+Alt+B |
| Fast Preview Build | Ctrl+Alt+Shift+B | Cmd+Alt+Shift+B |
| View PDF | Ctrl+Alt+V | Cmd+Alt+V |
| Show Position in PDF (SyncTeX) | Ctrl+Alt+J | Cmd+Alt+J |
| Stop Build | Ctrl+Alt+X | Cmd+Alt+X |
| Clean Auxiliary Files | Ctrl+Alt+C | Cmd+Alt+C |
| Insert Environment | Ctrl+Alt+E | Cmd+Alt+E |
| Wrap Selection in Environment | Ctrl+Alt+W | Cmd+Alt+W |
| Insert Citation | Ctrl+Alt+[ | Cmd+Alt+[ |
| Close Current Environment | Ctrl+Alt+] | Cmd+Alt+] |

All commands are in the Command Palette under **LaTeX Studio**. Reverse SyncTeX is Ctrl-click
(Cmd-click on macOS) in the PDF, or double-click if you set `latexstudio.viewer.reverseSyncClick`.

## Configuration

Settings are under **LaTeX Studio** in the Settings editor. The ones you are most likely to change:

| Setting | Default | Meaning |
|---|---|---|
| `latexstudio.build.autoBuild` | `onSave` | `never` turns off building on save |
| `latexstudio.build.recipe` | `latexmk (pdf)` | Default recipe |
| `latexstudio.build.outDir` | (empty) | Output folder relative to the root, e.g. `build` |
| `latexstudio.rootFile` | (empty) | Fix the root document instead of detecting it |
| `latexstudio.bib.profile` | `standard` | `minimal`, `standard` or `strict` field expectations |
| `latexstudio.spell.language` | `en_US` | Dictionary; a file can choose with `% !TeX spellcheck = en_GB` |
| `latexstudio.format.tool` | `builtin` | `latexindent` or `tex-fmt` instead of the built-in formatter |

### Your own tools and recipes

```jsonc
"latexstudio.build.tools": [
  { "name": "glossaries", "command": "makeglossaries", "args": ["%DOC%"], "cwd": "%OUTDIR%" }
],
"latexstudio.build.recipes": [
  { "name": "pdflatex + glossaries", "tools": ["pdflatex", "glossaries", "pdflatex"] }
]
```

Placeholders: `%DOC%` (root without extension), `%DOCFILE%`, `%DOC_EXT%`, `%DIR%` (root folder),
`%OUTDIR%`, `%PATHSEP%`. Tools run directly, never through a shell. A file can pick a recipe with
`% !LS recipe = pdflatex + glossaries`.

## Bibliography checker

The checker runs on every `.bib` file of the project as you type and reports problems with a code
such as `bib/missing-required` or `bib/invalid-doi`. Each entry gets a completeness score:

    score = 70 × (share of required fields present)
          + 20 × (share of recommended fields present, per profile)
          + 10 × (1 − 0.25 × number of value problems, at least 0)

To silence a rule for one entry, put a comment above it: `% bib-ignore: missing-doi`. To change
a rule everywhere: `"latexstudio.bib.rules": { "bib/missing-doi": "off" }`. The full rule list
is in [docs/bibliography-rules.md](docs/bibliography-rules.md).

The same checker runs on the command line, for CI or a pre-commit hook:

```sh
npx latexstudio-bibcheck references.bib --tex main.tex --profile strict --format sarif --fail-on warning
```

## Files LaTeX Studio writes

LaTeX Studio only writes generated files, and only these:

- Build output next to your root document (or in `latexstudio.build.outDir`), written by TeX.
- `.latexstudio/` next to the root: `fast/` and `partial/` builds, `history/` snapshots,
  `snapshots/` (a copy of an existing PDF before the first build overwrites it), `diff/`, and
  `dictionary.txt` (project words). It contains its own `.gitignore`; commit `dictionary.txt` if
  you want to share project words.

Your `.tex` and `.bib` files change only when you edit them or accept an action (quick fix,
rename, table wizard, restore), and always through VS Code, so Undo works.

## Known limitations

- Indexing runs on the extension host thread (spell checking runs in a worker). It is fast on
  theses of a few hundred pages, but very large projects may notice it. See [docs/performance.md](docs/performance.md).
- Fast preview and partial builds need `latexmk`. Partial builds work for `\include`d files only.
- The visual (rich text) editor, comments and tracked changes, Zotero, online metadata lookup
  (DOI, arXiv) and real-time collaboration are not in this release.
- Spell checking ships with English dictionaries only; add others with `latexstudio.spell.dictionaryPath`.
  Language switches inside a document (`\selectlanguage`) are not followed yet.
- Words written with TeX accents (`M\"uller`) are not spell checked.

## Development

```sh
npm ci
npm run build        # bundles into dist/
npm test             # unit tests; build and SyncTeX tests run when latexmk/pdflatex are installed
npm run lint
npm run typecheck
npm run package      # produces latexstudio-<version>.vsix
npm run gate:dissertation   # builds the Dissertation/ fixture in a temporary copy and writes reports/
```

Open this folder in VS Code and press F5 (choose **VS Code Extension Development** if asked) to
start an Extension Development Host; run `npm run watch` alongside to rebuild on change. The code is
organised as described in [docs/architecture.md](docs/architecture.md).

## License

MIT.

### Included software and data

| Component | License | Used for |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) 4.10.38 | Apache-2.0 | PDF viewer |
| [MathJax](https://github.com/mathjax/MathJax-src) 3.2.2 | Apache-2.0 | Math previews in hovers |
| [nspell](https://github.com/wooorm/nspell) 2.1.5 | MIT | Spell checking |
| [JSZip](https://github.com/Stuk/jszip) 3.10.1 | MIT (dual MIT/GPLv3, used under MIT) | ZIP export |
| [Papa Parse](https://github.com/mholt/PapaParse) 5.5.3 | MIT | CSV/TSV import in the table wizard |
| [tree-kill](https://github.com/pkrumins/node-tree-kill) 1.2.2 | MIT | Stopping builds with all child processes |
| English dictionaries `en_US`, `en_GB` ([`dictionary-en`](https://github.com/wooorm/dictionaries), from [SCOWL](http://wordlist.aspell.net/)) | MIT AND BSD | Spell checking; license files ship in `dist/dictionaries/` |

The command list, symbols, error explanations, snippets and BibTeX/BibLaTeX field tables in
`data/` and `snippets/` were written for this project (the field tables follow the BibTeX and
BibLaTeX documentation) and are under the project's MIT license.
