# Architecture

The code is split by what it is allowed to depend on. That keeps most of the logic testable
without VS Code, and lets the command-line checker and the Dissertation gate run exactly the code
the extension runs.

```
src/core/       pure logic, no vscode and no file system: parsers, scanners, transformations
src/build/      Node only (child processes, files): build runner, recipes, history, export
src/extension/  VS Code integration: providers, commands, views, panels
src/webview/    browser code for the panels (PDF viewer, Bib Manager, forms, wizards)
src/cli/        latexdesk-bibcheck and the bundle used by scripts/
data/           JSON tables: commands, symbols, error explanations, BibTeX field rules
```

`esbuild.mjs` bundles four groups: the extension host (`dist/extension.js`), two lazily loaded
extras (`dist/mathjax.js` on the first math hover, `dist/spellWorker.js` in a worker thread), the
CLI, and one script per webview in `dist/webview/`.

## Core (`src/core`)

| File | Responsibility |
|---|---|
| `text.ts` | Helpers shared by the parsers: line/offset maps, masking of comments and verbatim, reading `{}`/`[]` groups |
| `texParser.ts` | One pass over a `.tex` file: sections, labels, references, citations, includes, graphics, packages, definitions, environments, TODOs, magic comments |
| `project.ts` | Follows includes from the root document to build the project (files, bibliographies, graphics, unresolved references) and detects the root |
| `bibParser.ts` | Tolerant BibTeX parser that records offsets instead of rewriting anything |
| `bibScanner.ts` | The rule engine behind the checker, the score and duplicate detection |
| `bibEdit.ts` | Minimal text edits for `.bib` files (set/insert/remove a field, change type, suppress) |
| `logParser.ts` | LaTeX log and BibTeX/Biber `.blg` parsing |
| `synctex.ts` | SyncTeX reader for forward and reverse search |
| `prose.ts`, `wordCount.ts` | Prose extraction for spelling and word counts |
| `formatting.ts` | Toolbar text operations: toggle a command, change text size, align lines |
| `flatten.ts`, `table.ts`, `formatter.ts`, `explain.ts` | Export transformations, the table model and row/column operations, the built-in formatter, error explanations |

The rule for edits: a change is always the smallest replacement of a known range, applied through
a `WorkspaceEdit`, so untouched text stays byte identical and Undo works.

## Build (`src/build`)

`BuildRun` (runner.ts) executes a recipe: each tool is spawned directly with an argument array
(no shell), output is streamed, and `cancel()` kills the whole process tree. Between steps it
skips work that is not needed (no `\bibdata` → no BibTeX; references stable → no extra pass).
`waitForStablePdf` only hands a PDF to the viewer once its size has settled and it ends with
`%%EOF`.

Fast preview and partial builds use the same runner with a latexmk tool that adds TeX code before
the root file (`-usepretex`), in `.latexdesk/fast` or `.latexdesk/partial`.

`HistoryStore` keeps snapshots in `.latexdesk/history/`: an `index.json` and gzipped objects
named by content hash. `exporter.ts` plans, writes and verifies submission packages, including the
source ZIP (`listSourceFiles`, a folder walk that leaves out build output and compiled PDFs).
`watermark.ts` stamps a copy of a PDF with pdf-lib; it is its own bundle (`dist/watermark.js`),
loaded only when the command runs. `templateFiles.ts` downloads and safely extracts template ZIPs.

## Extension (`src/extension`)

`extension.ts` creates the services and registers commands; activation does no file system scan.
The main services and who uses them:

```
ProjectManager ── root detection, parsed files, bibliographies (re-parses only changed files)
  ├─ BuildManager ── builds, diagnostics, fast/partial previews ──> PdfViewerManager ──> SyncTexService
  ├─ BibHealth ── .bib diagnostics, quick fixes ──> BibManagerProvider, BibEntryForm
  ├─ languageFeatures / rename / liveChecks / spell ── editor features
  ├─ EditorToolbar (toolbar.ts) ── commands of the title-bar buttons ──> ToolsView (left mini bar)
  ├─ sharing.ts ── Create Source ZIP, Export PDF with Watermark
  ├─ TemplateGallery ── Create from Template (catalog download and cache, project creation)
  └─ views / statusBar / panels / history / exportPanel / tableWizard ── UI
```

Webviews talk to the extension with plain `postMessage` messages (`{ type: ..., ... }`). Every
webview uses `webviewHtml()` from `util.ts`, which sets a strict Content Security Policy and
loads only bundled files.

## Tests

- `test/core.test.ts`, `test/features.test.ts`: parsers, scanner, edits, history, rename helpers,
  table model, prose extraction.
- `test/build.test.ts`: real latexmk builds of `test/fixtures/thesis` (full, fast, partial, export
  with test compile). Skipped when latexmk is missing.
- `test/synctex.test.ts`: compares the SyncTeX reader with the `synctex` tool on a fresh build.
- `scripts/dissertation-gate.mjs`: the end-to-end gate on the real thesis; see the README.
