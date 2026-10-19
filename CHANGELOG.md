# Changelog

## 0.2.1

### Fixed

- **Pictures on the extension page.** The screenshots, animations and icon in the README now load on
  the Marketplace and in VS Code's extension details, and the README's links to the privacy,
  performance and bibliography-rule pages open again.

## 0.2.0

### Fixed

- **Accented names in the bibliography.** Authors, titles and other fields written with TeX accents
  now display as real letters everywhere: the Bib Manager, citation hovers, citation search and the
  side bar. `{\"O}zi{\c{s}}ik` now reads *Özişik* instead of `\"Ozicsik`. All standard accents are
  covered (`` \' \` \^ \" \~ \= \. \u \v \H \c \k \r \d \b ``, including dotless `\i` and `\j`), as well as
  special letters such as `\ss`, `\o`, `\aa`, `\ae` and `\l`.
- **Escaped characters.** `\&`, `\%`, `\$`, `\#` and `\_` in bibliography fields show as plain
  characters. Web addresses keep a literal `\~` as written.

### Improved

- **Duplicate detection ignores accents.** Entries such as `M{\"u}ller`, `Müller` and `Muller` with the
  same title and year are now flagged as possible duplicates.
- **New README** with screenshots and short animations of the main features, and a separate
  developer guide (`README_DEV.md`) for contributors.

## 0.1.0

First release.

- **Build:** recipes (latexmk, pdflatex → bibtex → makeindex, XeLaTeX, LuaLaTeX, Tectonic, your own),
  magic comments, build on save, stop, clean, separate output folder, and extra passes only when
  needed. Fast preview builds (draft images) and "Build This Chapter Only" for `\include`d chapters
  run in `.latexdesk/` without touching the full build.
- **Problems and log:** LaTeX, BibTeX and Biber messages in the Problems view, a log viewer with the
  file stack, and plain-language explanations of common errors (extendable with `latexdesk.errors.extra`).
- **PDF viewer:** zoom, fit, layouts, search, outline, links and dark pages, keeping your place
  across rebuilds; forward and reverse SyncTeX read in-process.
- **Editor window:** buttons in the editor title bar (Undo, Redo, Compile, Build & View, View Log,
  Part ▾, Label ▾, with the rest under "…") and the **LaTeX Tools** mini bar (full toolbar,
  formatting, alignment, text size, equations and symbols).
- **Language features:** completion, hovers (including rendered math), go to definition, references,
  rename for labels, citation keys, commands and environments, outline, folding, live checks and
  offline spell checking (US and UK English).
- **Editing:** snippets, environment commands, automatic `\item`, and a table wizard (also from
  spreadsheet data or CSV) plus row and column buttons for the table under the cursor.
- **Bibliography:** checker with stable rule codes and a completeness score, quick fixes, Bib Manager
  (table, triage and health report), entry form, citation search and a command-line checker.
- **Project tools:** dashboard, history snapshots with labelled versions, diff, restore and latexdiff
  PDFs, and export for submission (arXiv, journal, full project ZIP) with a test compile.
