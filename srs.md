# Project Specification: Build LaTeX Desk, a Fast, Production Grade LaTeX Authoring Extension for Visual Studio Code

**Revision 2.4** (October 2026) adds the duplicate package check (TS-41), the source ZIP for publishers (OL-48), watermarked PDF export (OL-49), and the online template library behind "Create from Template" (OL-50 to OL-58), and lists the template catalog in the network inventory.

**Revision 2.3** (October 2026) brings the specification in line with the first published versions (0.1.0 to 0.2.1): the product name and Marketplace identity, the editor window toolbars (TS-35 to TS-40), the Bib Manager triage view and Unicode display of TeX accents (BIB-47 to BIB-49), the thesis now kept in the private repository under `thesis/`, the README and image hosting for the Marketplace, and the removal of other products' names from this document.

**Revision 2.** This revision extends the original specification (no longer kept in the repository) with explicit performance budgets, a bibliography editor with completeness scanning, desktop-editor productivity tooling, and online-editor workflow features. All requirements of the original specification remain in force unless a section below explicitly tightens or replaces them.

**Revision 2.2** (figures now supplied; see the Dissertation fixture) refines the Dissertation build gate. **Revision 2.1** added the Dissertation build gate: the product is not finished until the author's real thesis, supplied in the `thesis/` folder, compiles through the tool to `main.pdf` (see the final validation gate in the acceptance criteria section).

**Conventions.** Requirement identifiers such as `PERF-3` or `BIB-12` are stable (the `TS` and `OL` prefixes are kept as plain identifiers) and must be referenced by tests, benchmark names, and the final acceptance report. "Must" is mandatory. "Should" is expected unless a documented technical reason prevents it. "May" is optional. Feature provenance tags: **[LW]** current LaTeX Workshop-class baseline, **[TS]** desktop LaTeX editor class, **[OL]** online LaTeX editor class, **[BIB]** bibliography editor, **[NEW]** novel to this product.

## 1. Role and mission

Act as a senior software architect, experienced TypeScript developer, performance engineer, VS Code extension specialist, LaTeX toolchain engineer, PDF viewer developer, BibTeX/BibLaTeX tooling specialist, and test engineer.

Your task is to design, implement, test, and document **LaTeX Desk**, a complete Visual Studio Code extension that is the fastest and most capable LaTeX authoring environment available inside VS Code. It must combine three things in one coherent product:

1. **The current feature set**: everything a modern integrated LaTeX environment such as James Yu's LaTeX Workshop provides (project discovery, compilation, diagnostics, PDF viewing, SyncTeX, language intelligence, snippets, outline, formatting, linting, word count).
2. **The best of desktop LaTeX editors**: the productivity tools their users rely on (structure and symbol panels, wizards, math assistance, macros, built-in spell checking, live syntax checks, project-wide search and refactoring, table tooling).
3. **The best of online LaTeX editors**: the zero-friction cloud-editor workflow their users rely on (near-instant recompile feedback, a visual editing mode, comments and tracked changes, project history, templates, paste-an-image workflows, friendly error explanations, collaboration, export for submission).

On top of those, it must provide a **first-class BibTeX/BibLaTeX editor** that makes bibliography files pleasant to edit and that scans them for completeness and correctness (see the Bibliography editor section).

The extension must support the complete LaTeX authoring workflow: writing source files, navigating multi file projects, managing bibliographies, discovering references, compiling documents, diagnosing errors, viewing generated PDFs, synchronizing source and PDF locations, formatting source code, reviewing and collaborating, and customizing the workflow.

This is a real software engineering project, not a demonstration, mockup, or prototype.

### Core objectives

1. Build a native VS Code extension using the official VS Code Extension API.
2. **Be measurably fast.** Speed is a product requirement with numeric budgets, a benchmark suite, and regression gates (see the Performance requirements section). "Lightning fast" must be demonstrated with measurements, never merely asserted.
3. Integrate with installed LaTeX distributions and external compilation tools rather than attempting to implement a TeX engine.
4. Provide a reliable, fast internal PDF viewer with navigation and source synchronization.
5. Implement useful LaTeX language intelligence, completion, hover information, snippets, diagnostics, and document structure navigation.
6. Support multi file projects, bibliography files, configurable compilation recipes, automatic builds, and log parsing.
7. Provide a dedicated bibliography editor with lossless editing, completeness scanning, duplicate detection, metadata enrichment, and safe project-wide refactoring.
8. Provide desktop-editor productivity tooling and online-editor workflow features, each with a real implementation.
9. Provide comprehensive commands, keyboard shortcuts, status indicators, settings, views, and context menus.
10. Work across Windows, macOS, and Linux, including VS Code remote development environments where technically applicable.
11. Remain responsive when working with large academic manuscripts and projects containing many files, citations, equations, figures, and tables.
12. Include real implementations for advertised features. Do not use fake progress indicators, dummy compilation results, hardcoded sample diagnostics, or placeholder buttons.
13. Build and test incrementally. Keep the extension executable throughout development.
14. **Prove it on a real thesis.** The final test of the tool's validity is that the author's multi file dissertation in the `thesis/` folder builds through the tool and produces `main.pdf` (see the final validation gate). Passing synthetic fixtures alone is not sufficient.

### Reference products and independence

Treat the official LaTeX Workshop repository and documentation, the manuals of popular desktop LaTeX editors, and the documentation of online LaTeX services as **functional references** for expected behavior only. Do not copy their branding, icons, assets, dictionaries, symbol databases, completion databases, help text, or implementation wholesale. Produce an independently designed implementation with its own name, identifiers, source code, data files, and user interface. Respect the licenses of any code, data, or assets used, and record the provenance and license of every bundled data set in the "Included software and data" section of the README. Do not create a separate third party notices file.

Do not scrape, reverse engineer, or automate undocumented web interfaces of online LaTeX services. Interoperate with them only through documented, supported mechanisms (project ZIP files and Git access where the user's plan provides it).

### Name and publication

The product is **LaTeX Desk**, with the identifier prefix `latexdesk` for commands, settings, views, the `.latexdesk/` project folder and the `latexdesk-bibcheck` command line tool. The first working name, LaTeX Studio, was dropped because a Marketplace extension already uses it; any future name must still contain "LaTeX".

- Marketplace identity: publisher `esquaredsystems`, extension `latexdesk`, full identifier `esquaredsystems.latexdesk`. Version 0.1.0 was first published on 19 October 2026.
- Source code: the private repository `esquaredsystems/latexdesk`.
- Public resources: the public repository `esquaredsystems/latexdesk-resources`, which hosts the README images and linked documents (see the Documentation and packaging section).
- Before renaming anything, check the Marketplace for an existing extension with the same display name, because the Marketplace rejects duplicate display names.

## 2. Initial repository inspection

Before writing implementation code:

1. Inspect the existing repository, project structure, package manager, build configuration, and installed dependencies.
2. Identify whether the repository already contains a VS Code extension or is a blank project.
3. Preserve useful existing code and avoid replacing unrelated functionality.
4. Establish the runtime, development, compilation, linting, and testing commands.
5. Create an implementation plan with milestones, dependencies, and acceptance criteria.
6. Identify external dependencies that must be installed by the user, including a TeX distribution, PDF utilities, and optional formatters or linters.
7. Distinguish mandatory dependencies from optional integrations.
8. Record platform specific requirements and known limitations.
9. Before writing feature code, create the benchmark corpus generator and the benchmark harness described in the Performance requirements section, and record baseline measurements of an empty extension (activation time, bundle size) so that later regressions are visible.
10. Decide and document the repository layout. The recommended layout is a workspace with separate packages: a pure `core` package (parsers, indexers, scanners, log parser, SyncTeX reader, with no `vscode` imports), a `cli` package (headless bibliography checker and index tools built on core), the `extension` package (VS Code integration), the `webviews` package (PDF viewer, Bib Manager, symbol palette, wizards, visual editor), and an optional `collab-server` package.

If the repository is empty, initialize a TypeScript based VS Code extension project using the official extension generator or equivalent supported tooling.

Do not stop after producing the plan. Begin implementing the system.

## 3. Product positioning and feature parity strategy

The goal is not to clone any single product. The goal is to take the strongest idea from each, implement it natively in VS Code, and make it faster.

### Capability map

| Capability | Source of the idea | Where specified |
| --- | --- | --- |
| Root detection, dependency graph, magic comments | [LW] [TS] | Project discovery |
| Recipes, latexmk, auto build, cleanup | [LW] [TS] | Build system |
| Log parsing and Problems integration | [LW] [TS] | Build log parsing |
| Internal PDF viewer, SyncTeX | [LW] [TS] [OL] | PDF viewer, SyncTeX |
| Completion, hover, definition, references | [LW] [TS] | Language intelligence |
| Live syntax and structure checks | [TS] | Language intelligence |
| Snippets, environment and list editing | [LW] [TS] | Snippets and editing productivity |
| Structure view, outline, folding | [LW] [TS] [OL] | Outline and navigation |
| Symbol palette, math assistant, wizards | [TS] [OL] | Desktop-editor productivity tools |
| Editor title bar buttons and the LaTeX Tools bar | [TS] [NEW] | Desktop-editor productivity tools |
| Table wizard, paste table from spreadsheet | [TS] [OL] | Desktop-editor productivity tools |
| Spell check and grammar check | [TS] [OL] | Desktop-editor productivity tools |
| Project-wide search and safe refactoring | [TS] [NEW] | Desktop-editor productivity tools |
| User macros and user snippets with triggers | [TS] | Desktop-editor productivity tools |
| Bibliography editor, completeness scanner | [BIB] [NEW] | Bibliography editor |
| Metadata enrichment from DOI, arXiv, ISBN | [BIB] [OL] | Bibliography editor |
| Zotero integration | [BIB] [OL] | Bibliography editor |
| Visual (rich text) editing mode | [OL] | Online-editor workflow |
| Comments and tracked changes | [OL] | Online-editor workflow |
| Project history and labelled versions | [OL] | Online-editor workflow |
| Real time collaboration | [OL] | Online-editor workflow |
| Online LaTeX service project interoperability | [OL] | Online-editor workflow |
| Paste or drop an image into a figure | [OL] | Online-editor workflow |
| Friendly error explanations | [OL] [NEW] | Build log parsing |
| Templates gallery | [OL] [TS] | Online-editor workflow |
| Submission and arXiv export | [OL] [NEW] | Online-editor workflow |
| Fast preview builds, partial builds | [NEW] | Build system, Performance requirements |
| Sub-frame incremental indexing | [NEW] | Performance requirements |

### Design principles

1. **Latency first.** Every interactive feature has a latency budget. Work that cannot meet the budget on the keystroke path moves to a worker or is made incremental.
2. **Never destroy the author's text.** Every automated edit (formatting, sorting, refactoring, enrichment, visual editing, tracked changes) must be minimal, previewable where it is large, and undoable through the normal VS Code undo stack. Unedited regions must remain byte identical.
3. **Offline by default.** Ordinary editing, compilation, completion, checking, and viewing require no network. Network features are explicit, user initiated, individually configurable, and disabled until the user opts in (see the security section).
4. **Honest tooling.** Where a result is an approximation (word counts, equation previews, fast preview builds, heuristic duplicate detection), the interface must say so.
5. **Progressive disclosure.** The default experience is clean. Advanced features are discoverable through the command palette, a single sidebar container, and documented settings.
6. **Composable core.** Pure, environment-agnostic logic (parsers, indexers, scanners, log parsers, SyncTeX reader) lives in a core package with no `vscode` imports, so it can run in workers, in a command line tool, and in tests.

## 4. Performance requirements

Speed is a first class, testable requirement. This section defines the budgets, the measurement method, and the architectural techniques that are mandatory to reach them. Other sections reference these identifiers.

### Reference environment and corpora

- **Reference hardware** for budgets: a 4 core x86-64 or Apple Silicon laptop (2020 or newer), 16 GB RAM, SSD, VS Code stable. Record the actual hardware, OS, VS Code version, Node version, and TeX distribution version with every benchmark run.
- **Benchmark corpora** (the generator and manifest are committed; large downloaded corpora are fetched by a script and never committed):
  - *Small*: a 10 page article, 1 file, 50 bib entries.
  - *Thesis*: the real dissertation in `thesis/` (about 250 pages, 20 `.tex` files, a custom document class, roughly 230 bibliography entries, about 215 labels, about 360 `\includegraphics` calls, an index, and a `bibtex` plus `makeindex` build). It is the author's own work. By the author's decision it is committed to the private source repository in `thesis/`, under its own CC BY-NC-ND 4.0 licence, and it is excluded from the packaged extension, from the public resources repository, and from CI. The gate reads it from `thesis/` by default, or from the path in the `LATEXDESK_DISSERTATION` environment variable. A deterministic synthetic substitute with the same shape (file count, entry count, label count, figure count, class-file based preamble, index) is generated for CI and for other contributors.
  - *Book*: a 1,000 page book, 200 files, 3,000 labels, 4,000 bib entries. A synthetic generator must produce this deterministically; a real open corpus such as the Stacks Project may be used as an additional, downloaded benchmark where its license permits.
  - *Bib stress*: a 10,000 entry, approximately 10 MB `.bib` file, plus a malformed variant (unbalanced braces, truncated entries, binary garbage).
  - *Long file*: a single 20,000 line `.tex` file.
- **Percentiles**: budgets are stated as p95 unless noted. Measure at least 30 samples after warm up.

### Latency and throughput budgets

| ID | Operation | Budget (reference hardware) |
| --- | --- | --- |
| PERF-1 | Extension activation (time until commands are registered, excluding background indexing) | Under 50 ms CPU on the extension host. No synchronous file system scan during activation. |
| PERF-2 | Added work on the keystroke path (everything the extension does synchronously per typed character) | Under 4 ms; no synchronous parse of more than the edited line neighborhood. |
| PERF-3 | Incremental re-index of the edited file after a keystroke (tokens, labels, citations, commands, environments, sections) | Under 10 ms for the 20,000 line file; cost proportional to the size of the edit and the damaged region, not the file size. |
| PERF-4 | Completion list for commands, citations, labels, or files (request to first result) | Under 30 ms warm, under 150 ms cold, on the Book corpus. |
| PERF-5 | Hover, definition, and reference lookup | Under 30 ms. |
| PERF-6 | Outline and structure view refresh after an edit pause | Under 20 ms for the edited file; visible update within 100 ms. |
| PERF-7 | Cold workspace index (no cache) of the Book corpus, in the background | Under 3 s to a usable index, with the editor fully responsive throughout (no event loop block over 16 ms). |
| PERF-8 | Warm start (persisted index cache valid) of the Book corpus | Under 400 ms to a usable index. |
| PERF-9 | Parse and index the 10,000 entry bib file | Under 400 ms off the main thread; re-scan of a single edited entry under 2 ms. |
| PERF-10 | Full bibliography completeness scan of 10,000 entries (all rules) | Under 1.5 s off the main thread; incremental rescan of one entry under 2 ms. |
| PERF-11 | Parse a 5 MB build log and publish diagnostics | Under 150 ms. |
| PERF-12 | Save to compiler process spawn, excluding the configured debounce | Under 100 ms. Extension overhead around a build must be under 5 percent of the raw compiler wall time. |
| PERF-13 | New PDF written to first visible page repainted in the viewer (Thesis corpus) | Under 250 ms, with no white flash and with the scroll position preserved. |
| PERF-14 | PDF viewer scrolling | Sustained 60 frames per second on the Thesis corpus; only visible pages plus a small prefetch window are rendered. |
| PERF-15 | Forward and reverse SyncTeX lookup | Under 50 ms warm on the Book corpus, under 400 ms for the first lookup after a new build (index construction). No process spawn on the lookup path. |
| PERF-16 | Spell check of a 20,000 line file, initial pass | Under 1 s in a worker; incremental recheck of the edited paragraph under 10 ms. |
| PERF-17 | Bib manager table with 10,000 rows: open, filter as you type, sort | Open under 500 ms; filter and sort under 100 ms; scrolling at 60 frames per second (virtualized rows). |
| PERF-18 | Project-wide search of the Book corpus (plain and regex) | First results under 100 ms; complete under 1 s. |
| PERF-19 | Memory | Index and caches for the Book corpus under 200 MB resident in aggregate across extension host and workers; the viewer keeps no more than a configurable number of rendered page bitmaps (default sized to under 300 MB). |
| PERF-20 | Main thread health | While indexing, building, scanning, or spell checking, the extension must not block the extension host event loop for more than 16 ms at a time (measured by an event loop delay monitor in tests). |

Budgets that depend on the TeX engine itself (for example, how long `pdflatex` takes to typeset) are not extension budgets. For those, the extension is held to the overhead limit in PERF-12 and to the speedup targets in the fast build modes below.

### Mandatory architectural techniques

1. **Lazy activation and lazy loading.** Activate on LaTeX and BibTeX language use or when the workspace contains relevant files. Bundle the extension host code into a single minified file with a modern bundler, and `import()` heavy modules (PDF viewer host code, spell checker, Bib manager, visual editor, collaboration) on first use. Measure and track bundle size.
2. **Worker threads for heavy work.** Run indexing, bibliography parsing and scanning, log parsing, spell checking, SyncTeX index construction, project search, and word counting in a pool of `worker_threads` (size configurable, default derived from CPU count minus one). The extension host keeps only thin providers that query worker-owned indexes. Transfer large buffers instead of copying them. Support cancellation of every worker request.
3. **Incremental, error tolerant parsing.** The TeX scanner and the bib parser must be incremental: keep per-line (or per-block) lexer state checkpoints and re-lex only from the edit until the state re-converges with the previous state. Both parsers must be total: any input, including truncated or binary input, produces a result without throwing, in time linear in the input size.
4. **Persistent index cache.** Persist per-file parse results in extension storage keyed by path, size, modification time, and a parser version stamp, with a content hash fallback. Validate lazily. A corrupt or stale cache must be discarded silently and rebuilt, never trusted.
5. **Query-oriented indexes.** Provide prebuilt, prefix-searchable structures for commands, labels, citation keys, and files so completion never scans the whole index. Rank with a precomputed score plus a cheap fuzzy match, and cap and stream results.
6. **Coalescing and cancellation.** Debounce file system events, coalesce bursts into one update, and cancel superseded work. Never do work for a document version that has already been replaced.
7. **Avoid serialization cliffs.** Do not send the whole index across the worker boundary. Send queries and receive small results.
8. **Native acceleration only when measured.** Implement the core in TypeScript first. If profiling on the reference corpora shows a budget cannot be met, port the hot path (for example the bib scanner or SyncTeX reader) to WebAssembly compiled from a memory safe language, loaded in a worker, with the TypeScript implementation retained as the reference oracle for differential testing. Do not add native binary dependencies that break remote, Apple Silicon, or Windows installs.
9. **Environment agnostic core.** The core package must not import Node-only or `vscode` modules, so that it can later run in a web worker (for example in vscode.dev) without a rewrite. Web extension support is a non-goal for the first release, but the core must not preclude it.

### Fast build modes

These are optional accelerations layered on the normal build. The normal, full build must always remain available, must be what a release or export uses, and must be clearly distinguished from fast preview output.

1. **Smart pass engine** (PERF-B1). For custom recipes the orchestrator must avoid unnecessary passes: rerun the engine only when the log requests it or the `.aux`, `.toc`, `.out`, or index files changed; run `bibtex` or `biber` only when the set of citations or the bibliography sources changed. For intermediate passes, use the engine's no-output mode (for example `-draftmode` for `pdflatex`, `-no-pdf` for `xelatex`) and write the PDF only on the final pass. With `latexmk`, rely on it for pass control and avoid redundant extra invocations.
2. **Preamble precompilation** (PERF-B2). A "fast preview" mode may dump the document preamble into a format file and reuse it until the preamble text changes (hash based invalidation), skipping repeated package loading. It must fall back automatically and visibly to a normal build if format creation or use fails, and must document engine limitations (known to be most reliable with `pdflatex`; experimental with `xelatex` and `lualatex`).
3. **Draft assets** (PERF-B3). A "fast preview" mode may skip image decoding and heavy figure processing (for example by passing `draft` options to graphics packages through the pre-text mechanism of `latexmk`, or equivalent), and may suggest TikZ externalization where heavy TikZ is detected.
4. **Partial builds** (PERF-B4). When the project uses `\include`, offer "build only this chapter" through a generated `\includeonly` that does not modify the user's source files; when it uses `subfiles`, build the active subfile. Partial builds must use a separate auxiliary directory so they never corrupt the full build's state, and must be labelled as partial in the UI.
5. **Supersede policy** (PERF-B5). In auto build mode, a newer change cancels an in-flight build that has not yet reached its final pass, keeps displaying the last good PDF, and never shows a half-written PDF.
6. **Stable PDF detection** (PERF-B6). Detect completed PDF output by waiting for size and modification time to stabilize and validating the file trailer before handing it to the viewer.
7. **Speedup targets.** On the Thesis corpus with a heavy preamble, a fast preview rebuild after a one-paragraph edit should be at least 2 times faster than the full build on the same machine, and the benchmark report must state the measured ratio. If the target is not met for an engine, document that honestly and keep the mode off by default for that engine.

### Benchmarks and regression gates

1. Provide a reproducible benchmark command (for example `npm run bench`) that runs the corpora and prints a table keyed by the budget identifiers above.
2. Benchmarks must exercise the real implementation (real parsers, real workers, real files). Mocked timings are not acceptable.
3. In CI, compare results to a stored baseline captured on the same runner class and fail the job on a regression of more than 10 percent in any p95 budget. Where CI hardware is too noisy for absolute budgets, gate on regression versus baseline and run the absolute budget check on the reference environment before release.
4. Include an event loop delay monitor in integration tests to enforce PERF-20.
5. Include a startup trace (activation time, time to first completion, time to first PDF) in the troubleshooting report command.
6. The final report must include the measured benchmark table, not just pass or fail.

## 5. Technology and architecture

Use the following baseline unless the existing repository provides a compelling technical reason to use an alternative.

### Extension host

- TypeScript with strict type checking.
- Node.js runtime supported by the selected VS Code extension API version.
- Official `vscode` API.
- A maintained package manager and reproducible dependency lockfile.
- A modern bundler (such as esbuild) producing a minified, tree shaken extension host bundle with lazily loaded chunks for heavy features.
- `worker_threads` for CPU heavy work (see the Performance requirements section).
- ESLint and a code formatter.
- A test framework compatible with VS Code extension tests.
- Webview based UI for the internal PDF viewer.
- A dedicated PDF rendering library, such as PDF.js, where licensing and compatibility permit.
- Native child process management for compilation and external tools.

Choose the minimum VS Code engine version based on the APIs actually required. Declare that version accurately in the extension manifest.

### Architectural modules

Organize the implementation into well defined modules with explicit interfaces.

1. Extension activation and lifecycle management.
2. Workspace and project discovery.
3. Root document detection.
4. LaTeX source parsing and document indexing.
5. Bibliography parsing and indexing.
6. Language intelligence and completion providers.
7. Snippets and editing commands.
8. Build orchestration and recipe management.
9. External process execution.
10. Log parsing and diagnostic publication.
11. File dependency tracking and automatic builds.
12. PDF discovery and internal viewing.
13. Source to PDF synchronization.
14. Document outline, navigation, and folding.
15. Formatting and linting integrations.
16. Configuration and settings validation.
17. Status bar, activity bar, tree views, and command palette integration.
18. Logging, error reporting, telemetry configuration if applicable, and troubleshooting.
19. Automated tests and end to end test infrastructure.
20. Worker pool, incremental parsing core, persistent index cache, and query indexes.
21. Bibliography parser, scanner, editor UI, enrichment clients, and Zotero bridge.
22. Spell and grammar checking.
23. Symbol palette, math assistance, wizards, macros, and project-wide search and refactoring.
24. Visual editor.
25. Review (comments and tracked changes), local history, templates, and export.
26. Collaboration client and relay server (optional, feature flagged).
27. Benchmarks and performance regression tooling.

Webview user interfaces (PDF viewer, Bib Manager, symbol palette, wizards, visual editor) must be built with a small dependency footprint, bundled separately from the extension host, loaded only when first shown, and budgeted for bundle size. Prefer framework free or very light frameworks for the always-open viewer.

Pure logic must be callable from the extension host, from workers, from the command line, and from tests without change. Cross-thread and cross-process interfaces must be typed and versioned.

Use dependency injection where it improves testability. Avoid a single enormous extension entry point.

Separate pure parsing and business logic from VS Code API calls. Define interfaces for build services, process execution, PDF navigation, project indexing, and diagnostic parsing.

Handle extension activation and disposal correctly. Dispose of event subscriptions, file watchers, output channels, terminals, webviews, child processes, and temporary resources when no longer needed.

## 6. Extension manifest and first run experience

Implement a complete `package.json` manifest with:

- Extension identity, display name, description, version, publisher (`esquaredsystems`), license, repository metadata, and engine compatibility.
- Activation events appropriate for the supported VS Code version.
- LaTeX and BibTeX language associations.
- Supported file extensions and language identifiers.
- Commands and command categories.
- Keyboard shortcuts with appropriate platform specific overrides.
- Configuration schemas and validation.
- Activity bar or sidebar views.
- Explorer and editor context menus.
- Editor title actions.
- Status bar integration.
- Snippet contributions where appropriate.
- Settings and walkthrough content where supported.
- An original 128 × 128 PNG Marketplace icon (`media/marketplace-icon.png`), a gallery banner colour, and screenshots only if original assets are supplied or created.
- Packaging configuration and files to exclude from the distributed extension.
- Custom editor contributions (Bib Manager, visual editor), comment controller, and walkthroughs.
- Declared capabilities for untrusted workspaces and virtual workspaces: features that execute external tools, run macros, or write outside the workspace must be disabled in untrusted workspaces, with a clear explanation; read-only intelligence may remain available.
- Activation events that keep activation cheap: activate on LaTeX and BibTeX documents and on workspaces containing relevant files, never on `*`.

Provide a welcome or setup experience when LaTeX is unavailable.

Detect common executables such as `latexmk`, `pdflatex`, `xelatex`, `lualatex`, `tectonic`, `bibtex`, `biber`, `kpsewhich`, `synctex`, `latexindent`, `tex-fmt`, `chktex`, `latexdiff`, `texcount`, `tlmgr`, and optional converters used for images (for example `pdftocairo`, `inkscape`, `magick`). Detection must be asynchronous and cached, and must not slow activation.

Report which tools are installed and which are missing. Do not require every optional utility to be present.

Explain how to install TeX Live, MiKTeX, or MacTeX as applicable, without automatically installing large system packages or changing system PATH settings without permission.

Allow the user to configure executable paths explicitly.

## 7. Project discovery and root document management

Support real world LaTeX projects with one or more root documents and arbitrarily nested included files.

### Root document discovery

Recognize common constructs including:

- `\documentclass`
- `\begin{document}`
- `\input`
- `\include`
- `\subfile`
- `\import`
- `\subimport`
- `\includeonly`
- `\bibliography`
- `\addbibresource`
- `\graphicspath`
- `\bibliographystyle` and `\printbibliography`
- `\externaldocument`
- `\usepackage{subfiles}` and `\RequirePackage`

Support `% !TeX root = path/to/main.tex` and relevant compiler or recipe magic comments.

Resolve relative and absolute paths correctly. Normalize paths across Windows, macOS, Linux, and remote workspaces.

If multiple root candidates exist, choose using explicit root declarations first, then reasonable project heuristics. If ambiguity remains, ask the user to select a root rather than silently compiling the wrong document.

Allow users to set and switch the root document explicitly.

Support a multi root workspace. Do not assume that one workspace corresponds to one LaTeX project.

Support subfiles workflows in which an individual chapter can be compiled independently or through the main document, according to configuration.

### Dependency graph

Build and maintain a dependency graph containing source files, bibliography files, graphics, class files, style files, and other discovered dependencies.

Parse dependencies incrementally when files change.

Use compiler generated `.fls` recorder information when available to discover dependencies missed by static parsing.

Handle cyclic includes safely, avoid infinite recursion, and report unresolved includes without crashing.

Ignore comments, verbatim environments, and obvious false positives during dependency extraction.

Recognize that arbitrary user defined TeX macros cannot always be evaluated statically. Fall back to compiler dependency information or conservative project indexing when necessary.

Support configurable include and exclude patterns for large workspaces.

Dependency extraction must be incremental and run in the worker pool, and a cold scan of the Book benchmark corpus must meet PERF-7 and a warm start must meet PERF-8.

Read project level build hints from `latexmkrc` and `.latexmkrc` files where they are present and safe to interpret statically (for example the main document and output directory), and expose them as suggestions rather than executing the Perl configuration yourself.

## 8. LaTeX language intelligence

Implement language features using VS Code providers and a shared, reusable source index.

### Syntax and language support

Support `.tex`, `.sty`, `.cls`, `.bib`, and relevant LaTeX related file types.

Support LaTeX, BibTeX, and optionally LaTeX3 or expl3 editing modes.

Integrate with existing language grammars where appropriate instead of unnecessarily rebuilding syntax highlighting from scratch.

Provide bracket matching, comment handling, indentation rules, language configuration, and sensible word patterns.

Support common mathematical syntax, environments, commands, references, citations, labels, package declarations, and document structure.

### Command completion

Provide context aware completion for:

- Standard LaTeX commands.
- Mathematical commands.
- Sectioning commands.
- Document environments.
- Font and text formatting commands.
- Package commands and package specific commands where metadata is available.
- Common document classes.
- Graphics and table commands.
- Bibliography commands.
- User defined commands discovered in project files.
- Commands declared with common forms of `\newcommand`, `\renewcommand`, and `\DeclareMathOperator`.
- Environment names declared in the project.
- Relevant optional arguments and required argument placeholders.

Trigger completion sensibly after a backslash, inside `\begin{}`, `\end{}`, `\usepackage{}`, `\documentclass{}`, and other relevant command arguments.

Rank suggestions according to context and usefulness.

Avoid offering thousands of irrelevant suggestions in every context.

### Environment completion

When the user begins `\begin{environment}`, suggest relevant environment names.

Provide configurable snippets or completion behavior for creating matching begin and end tags.

Support common environments such as:

- `document`
- `abstract`
- `equation` and `equation*`
- `align` and `align*`
- `gather`
- `multline`
- `itemize`
- `enumerate`
- `description`
- `figure`
- `table`
- `tabular`
- `array`
- `theorem`
- `proof`
- `verbatim`
- `lstlisting`
- `minted`
- `tikzpicture`
- `matrix` and common matrix variants.

Do not assume every environment exists in every document. Learn relevant names from the current project and installed package metadata when feasible.

### Citation completion

Support `\cite`, `\citep`, `\citet`, `\autocite`, `\parencite`, `\textcite`, and configurable citation commands.

Discover citation keys from:

- `.bib` files.
- `\bibliography{...}` declarations.
- `\addbibresource{...}` declarations.
- Files reachable through the project dependency graph.
- Configured external bibliography paths where accessible.

Provide citation key completion, author and title information where available, duplicate key detection, and useful filtering.

Support common BibTeX entry types and both BibTeX and BibLaTeX projects.

Handle incomplete bibliography entries and malformed files gracefully.

Do not invent citation keys or fabricate bibliographic metadata.

### Reference and label completion

Index `\label{key}` declarations across project files.

Support completion for `\ref`, `\eqref`, `\pageref`, `\autoref`, `\cref`, and configurable commands.

Display useful contextual information such as the label's type, containing section, and source file.

Support definitions in included files.

Report duplicate labels and unresolved references where appropriate.

### File and graphics completion

Provide path completion for:

- `\input`
- `\include`
- `\subfile`
- `\includegraphics`
- `\bibliography`
- `\addbibresource`
- `\usepackage`
- `\documentclass`

Offer relevant files from the workspace, respect relative paths, and support common graphics formats.

Allow extension settings to define additional searchable directories.

### Hover providers

Implement context aware hover information for:

- LaTeX commands.
- Environment definitions.
- Citation keys.
- Labels and references.
- Package names.
- Graphics file paths.
- User defined commands where their definitions can be extracted.

For citations, display available author, title, year, and bibliography source.

For references, display the corresponding label definition and surrounding section.

For commands, show a concise description and usage syntax when metadata is available.

Do not perform slow network lookups on every hover.

### Definition and references

Where practical, implement go to definition for:

- User defined commands.
- Environments.
- Labels.
- Citation entries.
- Included source files.
- Bibliography resources.

Support find all references for labels and user defined symbols when the index is sufficiently reliable.

### Additional language features

All language providers must be backed by the incremental, worker-owned project index and must meet PERF-3 to PERF-6.

- **Signature help** for commands, showing the argument structure and highlighting the active argument.
- **Document links** for `\input`, `\include`, `\includegraphics`, `\bibliography`, `\addbibresource`, and URLs, so they are clickable.
- **Document and workspace symbols** for sections, labels, environments, theorems, user commands, and bibliography entries.
- **Rename** for labels, user defined commands and environments, citation keys, and included files, with a full preview (see the Desktop-editor productivity tools section).
- **Code actions and quick fixes** from the live checks (add missing package, fix environment mismatch, replace obsolete command) and from the bibliography scanner.
- **Resolved numbers**: when `.aux` data is available, show the resolved number or title of a referenced label (for example "Equation 3.2", "Section 2.1") in the hover and optionally as an inline hint, and mark it stale when the build is older than the source.
- **Semantic highlighting** for user defined commands, environments, labels, and citation keys, on top of the TextMate grammar.
- **Fuzzy matching and learned ranking**: completion ranking uses context, project proximity, and a local usage frequency model stored on the user's machine only.
- **Math context awareness**: completion, snippets, and checks know whether the cursor is in text mode, inline math, display math, a table cell, a verbatim region, or a comment.
- **Live syntax and structure checks** as specified in the Desktop-editor productivity tools section.
- **Bibliography awareness**: citation completion and hover use the shared bibliography index described in the bibliography editor section, including completeness status.

## 9. Snippets and editing productivity

Ship a broad, organized snippet collection covering academic writing, mathematics, and document structure.

Include snippets for:

- Section, subsection, and subsubsection.
- Abstract and acknowledgments.
- Equations and aligned mathematics.
- Fractions, matrices, sums, integrals, limits, and derivatives.
- Theorem, lemma, proposition, corollary, definition, and proof.
- Itemized and enumerated lists.
- Figures, subfigures, tables, and captions.
- Tabular environments and common column layouts.
- Bibliography and citation commands.
- Cross references and labels.
- Text formatting and mathematical alphabets.
- Algorithms and pseudocode.
- Listings and code blocks.
- TikZ environments.
- Common academic document templates.

Use tab stops and linked placeholders intelligently.

Include an environment insertion command that asks for an environment name and creates a matching pair.

Include a selection wrapping command that can surround one or more selections with a chosen command or environment.

Support multiple cursors and selections where VS Code permits it.

Implement a safe command for converting between display math forms such as `\[...\]` and `\begin{equation}...\end{equation}` when the transformation is structurally valid.

Provide a command to close the current environment and intelligent handling of common list editing workflows.

When pressing Enter inside an `itemize` or `enumerate` list item, support configurable automatic insertion of the next `\item`. Handle empty items correctly so users can exit a list without accumulating unwanted empty items.

Support a configurable shortcut or completion menu for Greek letters, mathematical symbols, environments, and common font commands.

Avoid replacing normal editor behavior unexpectedly. Every special editing behavior must be configurable and documented.

User defined snippets and macros, wizards, the symbol palette, and the math assistant are specified in the Desktop-editor productivity tools section. Image paste and drop, templates, and the visual editing mode are specified in the Online-editor workflow section. All special editing behavior specified here must remain individually configurable, and each must be benchmarked against PERF-2 so it never makes typing feel slower.

## 10. Build system and compilation orchestration

Compilation is a core feature and must be implemented as a robust subsystem.

### Supported engines and tools

Support user configured recipes using:

- `latexmk`
- `pdflatex`
- `xelatex`
- `lualatex`
- `latex`
- `bibtex`
- `biber`
- `makeindex`
- `makeglossaries`
- `tectonic`
- `dvips` and `dvipdfmx`
- `latexdiff`
- Other user supplied executables.

Support common workflows involving bibliography generation, index generation, glossaries, and repeated compilation.

Prefer `latexmk` as the default recipe when installed and appropriate, because it can manage many compilation dependencies automatically.

The orchestrator must implement the smart pass engine, flicker free PDF handoff, and supersede policy defined in the Performance requirements section (PERF-B1 to PERF-B6), and extension overhead must meet PERF-12.

Provide sensible default recipes for common engines while allowing complete user customization.

### Recipe model

A recipe consists of an ordered sequence of tool invocations.

Each tool must support:

- A name.
- An executable command.
- An argument array.
- Environment variables.
- A configurable working directory.
- Timeout and cancellation behavior where appropriate.

Support variable substitution for root document, source directory, output directory, auxiliary directory, job name, and related paths.

Provide configurable settings for:

- `latex-workshop.latex.tools` compatible conceptual tool definitions under the extension's own namespace.
- Build recipes.
- Default recipe selection.
- Last used recipe.
- Output directory.
- Auxiliary directory.
- Job name.
- Compiler arguments.
- Environment variables.
- Build working directory.
- Automatic build triggers.
- Compiler timeout.
- Cleanup behavior.
- Failure handling.
- Build verbosity.

Use the extension's own settings prefix if the extension has a different identity. Do not impersonate the original extension's identity or claim that its settings are automatically interchangeable.

### Build commands

Implement:

1. Build current LaTeX project.
2. Build with selected recipe.
3. Select default build recipe.
4. Build current root document.
5. Build the active subfile when supported.
6. Stop the current build.
7. Clean auxiliary files.
8. Clean all generated build files.
9. View the generated PDF.
10. Build and open the PDF.
11. Rebuild from scratch.
12. View build log and output.
13. Reveal generated files.
14. Configure or inspect available build tools.
15. Fast preview build (see the Performance requirements section, fast build modes).
16. Build only the current chapter or section (partial build).
17. Recompile from scratch with stop on first error, draft mode, and syntax pre-check toggles.
18. Build a latexdiff comparison against a snapshot or revision.
19. Toggle persistent watch mode (`latexmk -pvc` or the built-in watcher) per root.

Show compilation progress and the active root file, the current pass (for example "pdflatex pass 2", "biber"), and elapsed time, without fake progress percentages.

Handle concurrent builds safely. A new build should either cancel, queue, or supersede an earlier build according to a documented policy.

Do not leave orphaned child processes.

### Compilation process

Use argument arrays rather than constructing unsafe shell command strings.

Handle executable paths containing spaces, environment variables, Unicode paths, platform specific path separators, and nonzero exit codes.

Support cancellation and process termination on Windows, macOS, and Linux.

Capture standard output and standard error without blocking the extension host.

Do not assume a successful exit code guarantees that a usable PDF exists.

Distinguish compilation failure, warnings, missing executables, missing packages, missing fonts, and missing output artifacts.

Preserve relevant logs for debugging.

### Automatic compilation

Support configurable triggers such as:

- Never automatically build.
- Build when a source file is saved.
- Build when relevant project dependencies change.
- Build after a configurable debounce period.
- Build manually only.

Watch relevant source files, bibliography files, graphics when applicable, and other dependencies.

Prevent infinite rebuild loops caused by generated output files.

Ignore auxiliary directories and irrelevant generated files.

Coalesce rapid changes into a single pending build.

Avoid rebuilding when the source has not materially changed.

Allow the user to disable automatic compilation temporarily.

### Magic comments

Support common magic comments for root selection, compiler selection, and recipe selection.

Recognize applicable directives near the start of source files.

Apply documented precedence rules between explicit user actions, project configuration, file directives, and defaults.

Validate requested recipes and compilers before starting a build.

Explain invalid directives through a diagnostic or notification.

### Output directories and cleanup

Support separate output and auxiliary directories.

Resolve relative paths consistently.

Avoid deleting user source files, referenced assets, bibliography files, or unrelated workspace files.

Provide a preview or confirmation before potentially destructive cleanup.

Maintain a clear distinction between auxiliary artifacts and final deliverables.

## 11. Build log parsing and diagnostics

Parse output from common LaTeX engines, `latexmk`, BibTeX, Biber, and related tools.

Support traditional TeX error forms, file and line references, missing package messages, undefined control sequences, undefined references, citation warnings, overfull boxes, and underfull boxes.

Publish diagnostics through VS Code's `DiagnosticCollection`.

Use correct file URIs and line ranges whenever available.

Classify issues as errors, warnings, and informational messages.

Include source location, message, relevant log excerpt, and originating tool when possible.

Support clickable diagnostic navigation.

Provide an output channel for complete compiler output and a focused problems view for actionable issues.

Parse nested error context, including the file stack and included files.

Avoid producing duplicate diagnostics from repeated passes over the same log.

Clear or update diagnostics intelligently after subsequent builds.

Allow configurable severity filters for noisy warnings.

Where compiler output cannot be mapped reliably to a source location, report the issue without inventing a line number.

Provide useful diagnostics even when compilation stops early.

### Streaming parse

Parse the log incrementally while the build is running, so errors appear in the Problems view and the status badge before the build finishes. Parsing must keep up with a fast compiler without blocking the extension host and must meet PERF-11 for completed logs.

### Bibliography tool logs

Parse `.blg` output of BibTeX and Biber, and map their messages to bibliography files and entries when possible (for example missing database entries, missing required fields reported by the tool, illegal characters, repeated entries, and "I couldn't open database file"). These diagnostics must be consistent with, and link to, the findings of the bibliography completeness scanner.

### Friendly error explanations

Ship an original, offline knowledge base of explanations for common TeX, LaTeX, package, BibTeX, and Biber errors and warnings (for example undefined control sequence, missing `$` inserted, file not found, runaway argument, extra alignment tab, missing `\begin{document}`, undefined environment, Unicode character not set up for use with LaTeX, `\cite` undefined, overfull box). Each entry has a short plain language explanation, the usual causes, a suggested fix, and where the fix is deterministic and safe a quick fix action. Show the explanation in the diagnostic's related information and through an "Explain this error" command and hover. Write all text originally; do not copy help text from other products. The knowledge base must be data driven and extensible by the user.

## 12. Internal PDF viewer

Build a fully functional PDF viewer inside VS Code using a webview and a suitable PDF rendering library.

The viewer must render actual generated PDF files. A static screenshot or mock PDF interface is not acceptable.

### Essential viewer features

- Open a generated PDF from a LaTeX build.
- Reopen the correct PDF when the root document changes.
- Navigate between pages.
- Display the current page and total page count.
- Zoom in and out.
- Fit page and fit width.
- Support configurable zoom behavior.
- Scroll vertically through pages.
- Search PDF text and navigate between matches.
- Select and copy text where supported.
- Open PDF links.
- Navigate table of contents or PDF outline when available.
- Rotate pages if practical.
- Support light and dark viewer themes where feasible.
- Provide a clear error state if the PDF is unavailable or invalid.
- Refresh the viewer after a successful rebuild.
- Avoid resetting the reader's position unnecessarily after refresh.
- Support large PDFs without rendering every page at full resolution simultaneously.

Support multiple PDFs and multiple root documents without confusing their state.

Use a virtualized or lazy rendering approach for large documents.

### Viewer navigation and actions

Provide commands to:

- View PDF.
- View PDF in an external application.
- Open PDF beside the source editor.
- Navigate to the next or previous page.
- Search within the PDF.
- Reveal the PDF in the file explorer.
- Refresh the PDF.
- Open the current source location in the editor.

Ensure webview resources use secure local resource URIs and a restrictive Content Security Policy.

Do not enable arbitrary scripts or external resource loading unnecessarily.

### Viewer performance requirements

- Render pages off the main thread where the platform permits (a PDF.js worker, with offscreen canvases where supported), render only the visible pages plus a small prefetch window, render a low resolution preview immediately and refine progressively, and cap the page bitmap cache by memory (PERF-14, PERF-19).
- **Flicker free refresh** (PERF-13): keep the old page images on screen until the new ones are ready, restore the scroll position by page and offset anchor, and when the new PDF has the same page count compare per page content so unchanged pages are not re-rendered. Never show a half written PDF (PERF-B6).
- Keep the loaded document and worker alive while the viewer is hidden, subject to a configurable memory policy, so reopening is instant.
- Stream large PDFs (range requests or lazy fetch) instead of reading them fully before the first page.

### Additional viewer features

- Continuous, single page, two page (spread), and presentation layouts; fit width, fit page, and custom zoom with remembered per-PDF state.
- Thumbnail sidebar and outline sidebar.
- Dark mode rendering modes (invert, tint, or follow the editor theme) with the option to leave images untouched.
- A snapshot tool that copies a selected region as an image.
- Link previews: hovering an internal PDF link (citation, reference, footnote) shows a small preview of the target region.
- Display of PDF annotations present in the file.
- Keyboard navigation and accessibility support (focus order, labels, high contrast).
- Optional: serve the viewer on a loopback-only local server for use in an external browser, with a random token, off by default.
- Open the viewer as an editor tab, beside the source, or in a separate window, and restore it on window reload.

## 13. Forward and reverse SyncTeX

Implement bidirectional source and PDF navigation using SyncTeX data produced by compatible TeX engines.

### Forward synchronization

When the user invokes forward synchronization from a source file:

1. Determine the active root document.
2. Resolve the source file and cursor position.
3. Identify the corresponding PDF and SyncTeX metadata.
4. Use the installed SyncTeX utility or another supported parser to map source location to PDF page and coordinates.
5. Navigate to the corresponding PDF location.
6. Highlight the destination briefly if supported.

### Reverse synchronization

When the user clicks a location in the PDF:

1. Determine the PDF page and click coordinates.
2. Query the SyncTeX mapping.
3. Resolve the corresponding source file and line.
4. Open the source file if it is not already open.
5. Reveal the relevant line and position the cursor appropriately.

### Synchronization requirements

- Work with included files, not just the root source.
- Handle missing or stale SyncTeX data gracefully.
- Detect when a fresh build is required.
- Account for output directories and nondefault job names.
- Use the correct SyncTeX executable and argument syntax for the platform.
- Keep synchronization state isolated between different projects and PDFs.
- Provide clear feedback when a mapping is unavailable.

Do not fake synchronization by guessing line numbers or opening the root file at an arbitrary location.

### In-process SyncTeX engine

To meet PERF-15, implement a SyncTeX reader in the core package that decompresses and parses the `.synctex.gz` data once per build into a compact, queryable index (for example typed arrays sorted by page and box), built in a worker and cached until the next build. Forward and reverse lookups then run without spawning a process.

- Keep support for the installed `synctex` command line tool as a configurable fallback and as the reference oracle: tests must compare the in-process results against the real tool on real SyncTeX files and fail on disagreement beyond a small tolerance.
- Handle the SyncTeX path conventions (relative and absolute input paths, output directories, job names, `.synctex` and `.synctex.gz`) and files that are being rewritten.
- Offer configurable triggers: a command, a keyboard shortcut, an optional automatic forward sync after each successful build, and a configurable click or modifier-click in the PDF for reverse sync.
- Highlight the destination in the PDF briefly and keep the highlight accurate when the page is re-rendered or the zoom changes.

## 14. Document outline and structural navigation

Provide a hierarchical document outline in a VS Code tree view.

Recognize common sectioning commands, including:

- `\part`
- `\chapter`
- `\section`
- `\subsection`
- `\subsubsection`
- `\paragraph`
- `\subparagraph`

Support configurable hierarchy mappings and user defined sectioning commands where feasible.

Show meaningful labels, source file locations, and navigation positions.

Allow the user to click an outline item to jump to its source location.

Update the outline as the source changes without requiring a complete document rebuild.

Support multi file projects and nested chapter files.

Where possible, include useful structural items such as figures, tables, equations, labels, bibliography resources, and included files in a secondary navigation view.

### Folding

Implement or register folding support for:

- Sections and subsections.
- Environments.
- Comments.
- Multi line commands where structurally safe.
- Other recognized logical blocks.

Avoid folding across unmatched environment boundaries or malformed source in ways that make the editor difficult to use.

### Structure view enhancements

- Show sections together with labels, floats (figures, tables, algorithms), equations that carry labels, `TODO` markers, included files, and bibliography resources, with filters and counts for each kind.
- Support drag and drop to promote, demote, and move sections, including across included files (see the Desktop-editor productivity tools section).
- Show the word count and the issue count (errors, warnings) per section where available.
- Follow the cursor, and let the user collapse to a chosen depth.
- Refresh incrementally within PERF-6.

## 15. Bibliography editor, citation browser, and completeness scanner

This section replaces the original "Citation browser and bibliography management" section. All original requirements are retained and expanded. The bibliography editor is a headline feature: editing `.bib` files must be faster, safer, and more informative than in any general purpose editor, and the completeness scanner must give the author a trustworthy answer to "is my bibliography ready to submit?".

### 15.1 Lossless bibliography parser (BIB-1 to BIB-6)

- **BIB-1** Implement a dedicated, incremental, error tolerant BibTeX/BibLaTeX parser in the core package (no `vscode` imports) that produces a lossless concrete syntax tree: entries, `@string`, `@preamble`, `@comment`, free text between entries, field names, values, delimiters (braces or quotes), concatenation with `#`, string macro references, numeric values, whitespace, and comments.
- **BIB-2** The parser must be total and linear time. Truncated entries, unbalanced braces, missing commas, stray text, mixed line endings, a byte order mark, and non UTF-8 or binary content must never throw and must recover at the next plausible `@` entry start, producing a located syntax issue instead of aborting the file.
- **BIB-3** Printing an unmodified tree must reproduce the input byte for byte (round trip identity). This is a hard invariant tested on all fixtures and on fuzzed input.
- **BIB-4** All edits (field changes, key renames, entry insertion, sorting, formatting, enrichment, merging) must be applied as minimal text edits to the VS Code document, so that untouched entries, comments, blank lines, and author formatting are preserved and the normal undo stack works. Never rewrite the whole file to change one entry.
- **BIB-5** Resolve `@string` macros, month abbreviations, concatenation, and `crossref`/`xdata`/`related` links into a resolved view for searching and checking, while keeping the raw text for display and editing.
- **BIB-6** Support both BibTeX and BibLaTeX syntax and semantics. Detect the dialect per project from `\usepackage{biblatex}`, `\addbibresource`, the use of `biber`, and per file hints, and allow an explicit per file or per workspace override (including a `% !BIB dialect = biblatex` style magic comment).

### 15.2 Bibliography editing experience (BIB-7 to BIB-14)

- **BIB-7** Provide a complete language mode for `.bib`: an original TextMate grammar (with embedded LaTeX highlighting in values), bracket matching, folding of each entry, document symbols (entries as symbols, grouped by type), and breadcrumbs.
- **BIB-8** Context aware completion inside `.bib`: entry types valid for the active dialect, field names valid for the entry type (required fields first, then optional, then others), `@string` macro names, month macros, `crossref` and `xdata` targets, and, for fields with controlled vocabularies (`langid`, `pubstate`, `entrysubtype`, `type`), the allowed values. Offer a snippet that creates a new entry with all required fields as tab stops, in the user's configured field order.
- **BIB-9** Hover on a field name shows its meaning, whether it is required or optional for that entry type and dialect, and any dialect alias. Hover on an entry key shows a formatted reference preview, the number of citations in the project, and the first few citing locations.
- **BIB-10** Show inline editor decorations (configurable) such as a completeness badge on the entry line and a citation count code lens ("cited 3 times", "never cited"), with click through to a peek list of citing locations.
- **BIB-11** Provide an **entry form editor**: a webview panel for the entry at the cursor with one input per field for the entry type, required fields marked, optional fields collapsible, per field validation messages, and live two way sync with the text (typing in the form edits the document via minimal text edits; typing in the text updates the form). Unknown fields are preserved and shown in an "other fields" list.
- **BIB-12** Provide a **Bib Manager** custom editor, selectable for `.bib` files through "Reopen Editor With", showing a sortable, filterable, virtualized table of entries (key, type, authors, title, year, venue, citation count, completeness score, issue count). It must be a `CustomTextEditorProvider` backed by the real text document, so the text editor and manager always agree, edits are undoable, and no separate save step exists. Support multi select, column chooser, saved filters (for example "incomplete", "uncited", "duplicates", "missing DOI"), and bulk actions (add field, remove field, set field value, change type, delete, merge, normalize).
- **BIB-13** Search across all bibliography files of the project and configured external files by key, author, title, year, journal or booktitle, entry type, keyword, DOI, and free text, with fuzzy matching, field scoped queries (for example `author:knuth year:1984`), and ranked results. Selecting an entry offers: insert citation key, insert full citation command (choosing among configured citation commands and optional arguments such as page notes), insert a bibliography resource declaration, open the entry, copy a formatted reference, and inspect all fields.
- **BIB-14** Provide **Add entry** commands: blank entry of a chosen type, from a pasted BibTeX, BibLaTeX, RIS, or CSL JSON string, from the clipboard automatically when it looks like an entry, from an identifier (see enrichment), and by dragging a PDF with embedded metadata or XMP onto the editor (best effort, shown for confirmation, never auto-committed).

### 15.3 Completeness and correctness scanner (BIB-15 to BIB-24)

The scanner is a rule engine over the parsed, resolved bibliography. It runs on demand, on save, and incrementally as the user types, and publishes results as VS Code diagnostics (Problems view, squiggles), as a per entry completeness score, and as a report.

- **BIB-15 Required field rules.** Encode the required and optional field tables as data (JSON), with sources recorded:
  - The standard BibTeX tables: `article` (author, title, journal, year); `book` (author or editor, title, publisher, year); `booklet` (title); `conference` and `inproceedings` (author, title, booktitle, year); `inbook` (author or editor, title, chapter or pages, publisher, year); `incollection` (author, title, booktitle, publisher, year); `manual` (title); `mastersthesis` and `phdthesis` (author, title, school, year); `misc` (none); `proceedings` (title, year); `techreport` (author, title, institution, year); `unpublished` (author, title, note).
  - The BibLaTeX tables for its full entry type set, including alternatives and aliases (for example `date` satisfying `year`, `journaltitle` accepted for `journal`, `location` for `address`, `institution` for `school`), derived from the BibLaTeX manual and verified against it in tests.
  - Entries that inherit fields through `crossref` or `xdata` must be evaluated with the inherited fields, so valid cross referenced entries are not falsely flagged.
- **BIB-16 Recommended field rules.** Configurable profiles define additional expectations beyond the formal minimum, at a configurable severity: for example DOI for articles, `pages` or article number for articles and proceedings papers, `url` with `urldate` for online sources, `isbn` for books, `publisher` and `address` for books, `volume`/`number` for journals, `editor` for collections. Ship built in profiles ("Minimal", "Standard", "Strict submission") and let users define their own profile in settings or in a workspace file such as `.latexdesk/bib-profile.json`, including venue specific profiles (for example "this journal requires DOIs").
- **BIB-17 Value quality rules.** Detect: empty fields; placeholder values (`TODO`, `TBD`, `???`, `xxx`, `unknown`, `lorem`); `et al.` or `others` in author lists written incorrectly (the correct BibTeX form is `and others`); malformed author lists (missing `and`, `First Last` mixed with `Last, First`, trailing `and`, empty names); a non numeric or implausible `year` (for example in the future or before 1400); invalid `month`; page ranges not using `--` (BibTeX en dash convention) or malformed ranges; invalid DOI syntax; invalid URL syntax; ISBN and ISSN length and checksum validation; arXiv identifier format and `eprint`/`archiveprefix` consistency; `volume`, `number`, and `edition` formatting; duplicate whitespace; unescaped special characters in text fields (`&`, `%`, `_`, `#`, `$`) where they are not intentional; mismatched TeX braces inside a value; accent notation mixed between LaTeX (`{\'e}`) and Unicode within one file; and titles whose acronyms or proper nouns are not protected by braces (advisory, since style files differ).
- **BIB-18 Structural rules.** Detect: duplicate keys (case insensitive, as BibTeX treats them); keys with illegal characters or whitespace; unknown entry types; unknown or misspelled field names with a "did you mean" suggestion (edit distance against valid fields); fields not valid for the entry type under the active dialect; fields defined twice in one entry; BibTeX only fields in a BibLaTeX project and the reverse, with a suggested alias conversion; `crossref` pointing to a missing or later defined key (BibTeX requires the target to come later); `@string` macros used but undefined, defined twice, or never used; and syntax issues from the parser (unbalanced braces, missing comma, truncated entry).
- **BIB-19 Duplicate entry detection.** Beyond duplicate keys, detect duplicate *works* using, in priority order, identical DOI, identical arXiv identifier, identical ISBN, and then a conservative fuzzy match on normalized title plus first author surname plus year. Present duplicates as groups with a similarity explanation, never auto-delete, and offer a guided merge (see 15.4). Fuzzy matches must be labelled as "possible".
- **BIB-20 Project cross checks.** Using the project index, report: citations in the manuscript whose keys are missing from all bibliography files; entries never cited (configurable as hint, warning, or off, because some bibliographies are intentionally larger than one document); citations that resolve to an incomplete entry (so the problem is visible at the citation site as well as in the `.bib`); and keys that differ only by case.
- **BIB-21 Completeness score.** Compute for each entry a score from 0 to 100 as the weighted share of satisfied required fields (heavily weighted), satisfied recommended fields from the active profile, and absence of value quality issues. Show it in the Bib Manager, as an optional decoration, and aggregated per file and per project. Document the formula in the README and expose the weights in settings.
- **BIB-22 Diagnostics and codes.** Every finding must have a stable machine readable code (for example `bib/missing-required`, `bib/duplicate-key`, `bib/invalid-doi`, `bib/unknown-field`, `bib/uncited`, `bib/placeholder-value`), a severity, a precise range (the field, the value, or the entry key; for a missing field, the entry key with the missing names in the message), a documentation link in the extension help, and per rule enable/disable and severity overrides in settings, including per entry suppression with a comment (for example `% bib-ignore: missing-required doi`). Never report a location that does not exist.
- **BIB-23 Report.** Provide a "Bibliography Health" view and a one page report with totals, a table of the most common problems, the least complete entries, duplicate groups, uncited and unresolved items, and a pass/fail verdict against the active profile. Offer export to Markdown, CSV, and JSON. Clicking any row navigates to the entry.
- **BIB-24 Headless scanning.** Ship the same scanner as a command line tool in the core package (for example `latexdesk-bibcheck <files...> --profile strict --format sarif|json|text`) that returns nonzero exit codes when findings meet a threshold, so the author can gate a continuous integration job or a pre-commit hook on bibliography quality. The CLI and the extension must share the same code and produce identical findings (tested).

### 15.4 Quick fixes, cleanup, and refactoring (BIB-25 to BIB-33)

All actions below must show a diff preview for any change touching more than one entry, apply as a single undoable edit, and never touch regions the user did not select or confirm.

- **BIB-25 Code actions** for single findings: insert empty stubs for missing required fields; apply a suggested field name; convert `journal` to `journaltitle` and the reverse; convert `year`/`month` to `date` and the reverse where lossless; normalize page ranges; add `and others`; wrap an acronym or proper noun in protective braces; escape a special character; add the DOI from a known identifier; rename a duplicate key; remove a duplicated field; define a missing `@string`.
- **BIB-26 Fix all** and "Fix all in file" for the deterministic, safe subset only. Anything requiring judgment (merging works, choosing between conflicting values) is never part of an automatic fix.
- **BIB-27 Format** entries according to a configurable style: indentation, `=` alignment, field order per entry type, brace or quote delimiters, trailing comma, line wrapping of long values, lowercase field names, consistent entry type case, and sorting of entries by key, year, first author, or type. Formatting must preserve comments and free text positions, keep author-defined grouping if sorting is limited to a region, and be idempotent (running twice changes nothing).
- **BIB-28 Key management.** Generate keys from a template (for example `[auth:lower][year][shorttitle:1]`) with uniqueness suffixes; validate existing keys against the template; and **rename a key across the whole project** (all `.bib` files and every citation command, including `\cite` family commands with multiple keys, `\nocite`, `\citeauthor`, `\textcite`, and user configured citation commands), with a preview of every affected location and a refusal when the new key already exists.
- **BIB-29 Merge duplicates.** A guided merge shows the candidate entries side by side, per field choices with conflicts highlighted, picks a surviving key, optionally keeps the removed keys as aliases through BibLaTeX `ids` or a comment, and offers to rewrite citations of the removed key.
- **BIB-30 Clean unused.** Preview and remove entries that are never cited by any document in the project (with a safety list for `\nocite{*}` projects), or move them to an archive `.bib` file.
- **BIB-31 Field cleanup.** Remove configurable noise fields exported by reference managers (for example `abstract`, `file`, `keywords`, `mendeley-tags`, `groups`, `timestamp`, `owner`, `date-added`), with a preview.
- **BIB-32 Normalizers.** Month to macro or number; DOI to bare form (strip `https://doi.org/`); arXiv URL to `eprint` fields; Unicode to LaTeX accents and LaTeX accents to Unicode; title case protection; journal name abbreviation and expansion using a bundled, original or permissively licensed journal abbreviation table that users can extend, with ISO 4 style as the default.
- **BIB-33 Convert dialect.** Convert between BibTeX and BibLaTeX field conventions with a complete preview and a report of fields that cannot be converted losslessly.

### 15.5 Metadata enrichment and import (BIB-34 to BIB-41)

All network behavior in this subsection is opt in, user initiated, and described in the privacy documentation (see the security section).

- **BIB-34** Resolve metadata from a DOI (Crossref REST API), an arXiv identifier (arXiv API), an ISBN (Open Library, and a configurable alternative), and a PubMed identifier (NCBI E-utilities). Provide a command "Add entry from identifier" and "Complete this entry from its identifier".
- **BIB-35** Never fabricate or guess bibliographic data. Every value written by enrichment must originate from the source response or from the user, and each enrichment result must show its source and retrieval date. When the source returns nothing or is ambiguous, say so.
- **BIB-36** Enrichment fills *missing* fields by default. Differences with existing values are shown in a field-by-field diff for the user to accept or reject individually; existing values are never overwritten silently.
- **BIB-37** Respect service etiquette: identify the client with a user agent and an optional user supplied contact email for polite API pools, apply rate limiting and exponential backoff, cache successful responses on disk with a configurable lifetime so repeated lookups are instant and offline repeatable, and batch work with a cancellable progress notification.
- **BIB-38** Provide "Enrich all incomplete entries" as a cancellable batch operation that only fetches for entries that have an identifier, shows a summary, and applies results in one undoable edit after confirmation.
- **BIB-39** Import from and export to RIS, CSL JSON, and EndNote tagged formats, and import from a Zotero or Mendeley exported `.bib` while keeping the original key unless the user chooses regeneration.
- **BIB-40** **Zotero integration.** Support a local connection to a running Zotero instance (the local connector interface, optionally with Better BibTeX, over loopback only) to search a library, insert citations, and append the chosen items to a designated `.bib` file with no cloud account needed; also support watching an auto-exported `.bib` file for changes. A Zotero web API mode using a user supplied API key stored in VS Code `SecretStorage` may be offered as an option. If Zotero is not running, degrade gracefully with a clear message.
- **BIB-41** Check for retractions or corrections as an optional, explicit, per-entry action when a DOI is present, using a documented public data source, and report the result without altering the entry.

### 15.6 Citation browser and project integration (BIB-42 to BIB-46)

- **BIB-42** Keep the original citation browser (a quick-pick and a sidebar tree) as the lightweight way to search and insert, backed by the same index and search as the Bib Manager.
- **BIB-43** "Where is this cited" from any entry or any citation key lists every citing location in the project, grouped by file, with a context snippet.
- **BIB-44** Show citation hover cards with author, title, year, venue, and completeness status, and flag incomplete or unresolved entries at the citation site without the user opening the `.bib` file.
- **BIB-45** Maintain correct behavior with multiple bibliographies, `\bibliography{a,b}` lists, `\addbibresource` with options, `refsection`, and per-chapter bibliographies, scoping each citation to the bibliographies actually available to it.
- **BIB-46** Support external bibliography paths found through `BIBINPUTS`/`kpsewhich` and user configured directories, read-only when outside the workspace.

### 15.7 Triage and display refinements (BIB-47 to BIB-49)

- **BIB-47 Triage view.** Besides the table (BIB-12) and the health report (BIB-23), the Bib Manager offers a **Triage** view that works through problems one at a time: findings grouped by rule with counts, the affected entries, a preview of the selected entry with missing fields highlighted, and actions to apply the fix, fix all safe findings (BIB-26), suppress the rule for the entry (BIB-22), open the entry in the text editor, and go to the next issue.
- **BIB-48 Unicode display of TeX accents.** The resolved view (BIB-5) turns TeX accent commands into Unicode letters for display, search and checking: all standard accents (`\'`, `` \` ``, `\^`, `\"`, `\~`, `\=`, `\.`, `\u`, `\v`, `\H`, `\c`, `\k`, `\r`, `\d`, `\b`), braced or not, including the dotless `\i` and `\j`, and special letters such as `\ss`, `\o`, `\aa`, `\ae`, `\oe` and `\l`; `\&`, `\%`, `\$`, `\#` and `\_` become plain characters. For example `{\"O}zi{\c{s}}ik` is shown as *Özişik* in the Bib Manager, hovers, citation search and the side bar. In `url`, `doi`, `file` and `eprint` fields only the escapes are decoded, so a literal `\~` stays as written. The source text is never changed by this.
- **BIB-49 Accent-insensitive duplicates.** The fuzzy duplicate match of BIB-19 compares titles and first-author surnames with accents and case folded, so `M{\"u}ller`, `Müller` and `Muller` with the same title and year form one "possible duplicate" group.

### 15.8 Bibliography safety rules

- Preserve the original formatting and comments when editing bibliography files.
- Do not silently rewrite the entire bibliography when the user only wants to insert one entry.
- Do not invent citation keys or fabricate bibliographic metadata.
- Always produce a backup point (for example a named local history snapshot, see the Online-editor workflow section) before a bulk operation that changes more than a configurable number of entries.

## 16. Hover previews and contextual information

Provide hover previews for mathematical environments, references, citations, graphics, and supported commands.

### Mathematics

When feasible, render a selected or hovered equation using MathJax or a compatible renderer.

Use the appropriate mathematical delimiters and rendering configuration.

Do not claim that the rendered equation is identical to the final PDF output. Packages, fonts, macros, and custom commands may produce differences.

Provide a graceful fallback when rendering fails.

### Figures and graphics

Preview supported image files when the cursor is over an `\includegraphics` path.

Resolve graphics search paths, relative paths, and common image extensions.

Report missing graphics without crashing.

### References and citations

Display the target label or citation metadata and allow navigation to the definition or bibliography entry.

### Command documentation

Display available command documentation and usage examples from a local metadata database or installed documentation source.

Network access must not be required for ordinary completion and hover operations.

Hover and preview data must come from the pre-built index and local caches; a hover must meet PERF-5 and must never trigger a network request or a compile. Equation rendering must happen in a worker or webview and must be cached by expression and macro context.

## 17. Formatting and linting

Provide optional integration with established LaTeX formatting and linting tools.

### Formatting

Support `latexindent` or a configurable equivalent.

Support BibTeX and BibLaTeX formatting through a suitable configurable tool if available.

Provide format document and format selection commands where the selected formatter supports them.

Respect user configuration files and formatting preferences.

Never silently reformat an entire document during an ordinary build.

### Linting

Support ChkTeX and other configurable linters.

Allow linting on save, on demand, or after a build.

Map warnings and errors to source locations when possible.

Deduplicate diagnostics from different tools where appropriate without hiding distinct problems.

Do not require external linting utilities for the extension to activate.

### Fast built-in formatting

External formatters such as `latexindent` can be slow to start on large files. In addition to the external integrations above:

- Provide a fast built-in formatter for the safe basics (environment and group indentation, trailing whitespace, blank-line normalization, optional line wrapping at a column or one sentence per line) that honors verbatim regions and is idempotent.
- Support `tex-fmt` as an additional configurable external formatter.
- Bibliography formatting is provided by the built-in bibliography formatter described in the bibliography editor section, with an optional external tool such as `bibtex-tidy`.
- Formatting a 5,000 line file with the built-in formatter should take under 100 ms off the main thread, and range formatting must only edit the requested range.

## 18. Word count and document statistics

Provide a document word count command and, where useful, a status bar item.

Support counting the current document or the complete project.

Offer configurable inclusion or exclusion of:

- LaTeX commands.
- Comments.
- Math environments.
- Bibliography entries.
- Captions.
- Footnotes.
- Abstracts.
- Headings.

Handle included files and prevent counting the same file multiple times.

Clearly document that word counts are approximations and may differ from publisher or submission system counts.

Counting runs in the worker pool and updates incrementally as files change. Optionally integrate `texcount` when installed, and show both results when they differ, labelled by source. Per section counts feed the structure view.

## 19. Desktop-editor productivity tools

These features bring the desktop LaTeX IDE experience into VS Code. Each one must be a real implementation, configurable, and lazily loaded so it adds nothing to activation time (PERF-1).

### 19.1 Live syntax and structure checking (TS-1 to TS-3)

- **TS-1** Run incremental, as-you-type checks (within PERF-3) and publish them as diagnostics distinct from compiler output: unmatched or mismatched `\begin`/`\end`; unbalanced braces, brackets, and math delimiters; unclosed or nested math mode errors; `\left` without `\right`; duplicate labels; unresolved `\ref`, `\cite`, and file references; commands used without their package loaded (with a "add `\usepackage{...}`" quick fix when the owning package is known from metadata); unknown or misspelled commands and environments with a "did you mean" suggestion, only when the project's package metadata is reliable enough to avoid false positives; obsolete commands and packages (for example `\bf`, `\it`, `\over`, `$$...$$`, `eqnarray`) with a modern replacement fix; unescaped special characters in text; mismatched quotes; stray `~` and spacing issues (advisory); and `\cite` or `\ref` with a missing preceding non-breaking space (opt in style rule).
- **TS-2** Every check must be individually toggleable and severity-configurable, must not run inside verbatim or comment regions, and must avoid false positives on user defined macros (learned from `\newcommand`, `\def`, and similar).
- **TS-3** Provide a package metadata database (commands, environments, options, dependencies) that is original or permissively licensed, loadable at runtime, extendable by the user, and importable from user supplied `.cwl` completion files. Do not bundle third party completion data unless its license permits redistribution, and record provenance. Optionally generate metadata from the installed distribution (`kpsewhich` plus a static scan of `.sty` files) in a background task.
- **TS-41 Duplicate packages.** A package that the project loads more than once (the same name in two `\usepackage` or `\RequirePackage` commands, in one file or in different files of the project, including names in a comma list such as `\usepackage{amsmath,amssymb}`) is underlined in red: an error diagnostic on every load after the first, with the first load given as related information. When the options of the two loads differ, the message says that LaTeX will stop with an "Option clash" error; when they are the same, it says the repeated load has no effect and can be removed. A quick fix removes the repeated load: the whole command when it loads only that package (with its line, when the line becomes empty), otherwise only the name and its comma. The check ignores comments and verbatim text, runs with the other live checks (PERF-3), and is turned off with them by `latexdesk.checks.enabled`. Repeated identical loads are harmless to LaTeX; they are still shown in red on purpose, because they usually come from preambles merged by copy and paste, and the next edit of one copy's options turns them into an option clash.

### 19.2 Symbol palette and math assistance (TS-4 to TS-9)

- **TS-4** A searchable **symbol palette** webview and sidebar panel with categories (Greek, operators, relations, arrows, delimiters, accents, text symbols, miscellaneous, and per-package sets), rendered glyphs, the command name, the required package, a usage count driven "recent" and "favorites" list, search by name, keyword, or drawing-free text (for example "arrow", "integral"), and one-click insert at the cursor or into all selections. Symbols requiring a package that is not loaded must offer to add the package.
- **TS-5** **Reverse symbol lookup**: search by pasted Unicode character (paste `∑` and get `\sum`) and by name. Drawing-based recognition is out of scope.
- **TS-6** A **math toolbar / quick insert panel**: fractions, roots, sub/superscripts, matrices with a size picker, cases, integrals and sums with limits, accents, delimiters with automatic `\left`/`\right`, and common environments, each producing correct snippets with tab stops.
- **TS-7** **Live math preview** (opt in): render the math under the cursor, or the selected math, in an inline decoration, a hover, or a side panel using a local MathJax or KaTeX build, using the document's own macro definitions where extractable. Clearly label it an approximation. Rendering runs in a worker or webview and must not block typing.
- **TS-8** Math editing helpers: auto-closing of `$`, `\(`, `\[`, and `\left`/`\right` pairs; toggle between inline and display math; convert `$$...$$` to `\[...\]`; split/join `align` lines; align `&` columns in multi-line math; wrap selection in `\text{}`, `\mathrm{}`, `\mathbf{}`, `\boldsymbol{}`, and similar; insert `\label` for an equation with a generated name.
- **TS-9** Optional **abbreviation expansion in math mode** (a user editable table, for example `ff` to `\frac{}{}`), active only inside math mode, off by default.

### 19.3 Wizards (TS-10 to TS-14)

- **TS-10 Quick start wizard.** Creates a new project or document: document class and options, paper size, font size, encoding/engine, `babel`/`polyglossia` languages, common packages with explanations, title/author fields, bibliography backend (BibTeX or BibLaTeX with Biber), and multi file layout (single file, chapters with `\include`, or `subfiles`). Produces files in a chosen folder without overwriting existing files, and generates a matching starter bib file.
- **TS-11 Table wizard.** A grid editor webview for `tabular`, `tabularx`, `longtable`, and `booktabs` styles: add/remove rows and columns, merge cells (`\multicolumn`, `\multirow`), column alignment and width types, borders and rules, header row, caption and label, math cells, and a source preview. It must be able to **parse an existing table in the document back into the grid** and write changes back as minimal edits. Provide "paste from spreadsheet / CSV / HTML clipboard" and "import CSV file" which create a table, and "export table to CSV".
- **TS-12 Graphics wizard.** Builds an `\includegraphics` call and optional `figure` environment: file picker restricted to the project's graphics paths, width/height/scale/angle/trim/clip, placement specifiers, centering, caption, label, and subfigure layouts.
- **TS-13 Other wizards.** Lists (nested, with labels), theorem-like environments (including defining them), `algorithm` blocks, and `listings`/`minted` code blocks with language selection.
- **TS-14** Every wizard must run offline, be keyboard operable, be available from the command palette, and generate source consistent with the packages already loaded by the project (adding missing `\usepackage` lines only after confirmation).

### 19.4 Macros and user defined snippets (TS-15 to TS-18)

- **TS-15** Users can define their own **snippets and macros** in settings or in a project file, with triggers: typed prefix, key chord, command palette entry, or event (on save, on build finished). Macro actions are declarative steps: insert text with placeholders and variables, wrap selection, run a registered extension command, or run a configured build recipe.
- **TS-16** For security, macros are read only from user and workspace configuration the user has trusted (honoring VS Code workspace trust). **Never execute scripts or commands embedded in LaTeX source files.** Do not provide arbitrary JavaScript execution. Document that VS Code tasks and other extensions cover advanced automation.
- **TS-17** Support importing the declarative parts of user tags exported from desktop LaTeX editors (text with placeholders) through a documented converter. Anything that depends on script execution is reported as unsupported rather than run.
- **TS-18** Provide variables such as selection, current file, root, section title, and date in snippet bodies.

### 19.5 Project-wide search and refactoring (TS-19 to TS-24)

- **TS-19 Find in project.** A fast search across all files of the project dependency graph (not the whole workspace) with plain, whole-word, and regex modes, scope selectors (current file, current section, current environment, all project files, bibliography files only), exclusion of comments, math, or verbatim as an option, and a results tree with context. Backed by a worker (PERF-18).
- **TS-20 Safe rename** for labels (updating every `\ref`-family use), user defined commands and environments (definition and uses), citation keys (see the bibliography section), and files (updating `\input`, `\include`, `\includegraphics`, `\subfile` paths), each with a full preview of changes and a refusal when the new name collides.
- **TS-21 Structure editing.** Promote and demote a section (and its subtree), move a section up or down (including drag and drop in the structure view, moving the text across included files correctly), extract a selection or section into a new included file with the correct `\input`/`\include`, and inline an included file.
- **TS-22 Environment editing.** Jump to the matching `\begin`/`\end`; select environment contents or the whole environment; change the environment name (both ends); toggle a starred environment; delete an environment while keeping its contents; surround with an environment; duplicate a line or block; swap list items up or down.
- **TS-23 Text transformations.** Rewrap paragraphs at a configurable column or to one sentence per line; change case; convert quotation marks to LaTeX style or `\enquote`; escape or unescape special characters; convert between Unicode characters and LaTeX commands; comment and uncomment blocks with `%`; sort selected `\item` entries or lines.
- **TS-24 Bookmarks and notes.** Bookmarks; a tree view of `TODO`, `FIXME`, `NOTE`, and custom tags found in comments (and in `todonotes` commands) with filtering, navigation, and counts; optional inline decorations.

### 19.6 Spell and grammar checking (TS-25 to TS-30)

- **TS-25** A built in, offline **spell checker** using Hunspell format dictionaries (through a maintained WebAssembly or pure JavaScript implementation, running in a worker, PERF-16). Dictionaries must be downloadable on demand from a configured source or supplied by the user, with their licenses recorded; do not bundle dictionaries whose license forbids redistribution.
- **TS-26** The spell checker must be **LaTeX aware**: it checks prose only and skips commands, math, comments (configurable), verbatim and listing content, citation keys, labels, file names, URLs, and arguments of configurable non-prose commands. It must learn language from `\usepackage[...]{babel}`, `\selectlanguage`, `\foreignlanguage`, `otherlanguage` environments, `polyglossia`, and the magic comment `% !TeX spellcheck = de_DE`.
- **TS-27** Squiggles with quick fixes: replace with suggestion, add to user dictionary, add to project dictionary (a committed `.latexdesk/dictionary.txt`), ignore in this document. Handle hyphenation commands, ligatures such as `\"a`, and `\-` correctly.
- **TS-28** Optional **grammar and style checking** through LanguageTool: preferably a locally running or user supplied server on loopback; a remote server only when the user explicitly configures one and accepts a privacy notice (see the security section). Prose is extracted with LaTeX markup removed and mapped back to exact source ranges.
- **TS-29** Provide synonym lookup and word statistics only from offline sources already available (for example a user supplied thesaurus), never by silently calling a web service.
- **TS-30** Spell and grammar checking must be fully disableable globally, per language, and per project, and must never delay typing.

### 19.7 Build and tooling conveniences (TS-31 to TS-34)

- **TS-31** A **quick build and view** command with an "in-editor" status, plus a user defined **tool menu** in the command palette for arbitrary external tools (for example `makeindex`, `latexdiff`, `pdftk`) configured in the recipe/tool model, with variable substitution and direct execution (no shell concatenation).
- **TS-32** A **package availability check** that reports missing packages found in the log or in `\usepackage` lines by querying `kpsewhich`, and shows the suggested `tlmgr` or MiKTeX console command for the user to run themselves. It never installs software automatically.
- **TS-33** An integrated **log viewer** with filtering by severity and by file, a collapsible file-stack tree, and direct navigation, in addition to the raw output channel.
- **TS-34** A **document statistics panel** extending the word count with counts of sections, figures, tables, equations, citations, labels, and pages (from the PDF), with project and file scope.

### 19.8 Editor window toolbars (TS-35 to TS-40)

The editor window is the most important view of the product. It must offer one-click access to the common actions of a desktop LaTeX editor without crowding VS Code.

- **TS-35 Editor title bar.** On LaTeX files, the editor title bar shows Undo, Redo, Compile, Build & View, View Log, **Part ▾** (inserts `\part` to `\subparagraph`) and **Label ▾** (inserts `\label`, `\ref`, `\eqref`, `\pageref`, `\cref` or `\cite` and opens the completion list of the project's labels or citation keys). VS Code shows only about seven extension buttons there, so Cut, Copy, Paste, the table row and column buttons, Highlight and Comment are placed in the "…" overflow menu.
- **TS-36 LaTeX Tools bar.** A webview view in its own activity bar container, revealed with the first `.tex` file, with: the full toolbar (undo, redo, cut, copy, paste, compile, build & view, log, part, label, add and delete table row and column, highlight, comment); a **Format** section (bold, italic, underline, strikeout, align left, centre, right and justify, larger and smaller text); an **Equation** section (inline, display, numbered and `align` math, fraction, root, superscript and subscript, sum, integral, limit, `\left( \right)`, `\text`, cases, and a matrix of any size with a choice of delimiters); and a **Symbols** section (by category, and searchable by name or by pasting the character). This view fulfils TS-4 and TS-6 in the side bar.
- **TS-37 Formatting behaviour.** Formatting buttons act on the selection, or on the word under the cursor when nothing is selected, and work as toggles: Bold on `\textbf{word}` removes the command. Larger and Smaller step through the size scale from `\tiny` to `\Huge`. Choosing the same alignment twice removes the alignment environment. Every change is a minimal edit and undoable.
- **TS-38 Table buttons.** Add Row, Delete Row, Add Column and Delete Column act on the `tabular`-family table under the cursor, keeping `&` and `\\` consistent. The column buttons refuse, with a clear message, on a table that uses `\multicolumn`, and the table wizard (TS-11) refuses tables with `\multicolumn`, `\multirow` or a nested table, so nothing is lost; such tables are edited in the source.
- **TS-39 Required packages.** When a button needs a package the document does not load (for example `ulem` for strikeout, `soul` for highlight, `ragged2e` for justify), offer to add the `\usepackage` line to the preamble. Never add it silently.
- **TS-40 Settings and assets.** `latexdesk.toolbar.enabled` turns the title bar buttons on and off, and `latexdesk.toolbar.showMiniBar` the LaTeX Tools bar. Toolbar icons are original, with light and dark variants.

## 20. Online-editor workflow

These features bring the frictionless, project-centred workflow of a cloud LaTeX editor to a local, offline-capable VS Code environment. Features that need servers (collaboration, online service interoperability) are optional, off by default, and isolated from the core so they cannot affect startup or offline use.

### 20.1 Instant feedback loop (OL-1 to OL-6)

- **OL-1** A one-click **Recompile** action and an optional "compile on every pause" mode built on the fast build modes (PERF-B1 to PERF-B6): the PDF updates beside the editor without flicker and without losing the reading position.
- **OL-2** Compile toggles in the status bar menu and the viewer toolbar: **stop on first error**, **draft/fast preview mode**, **syntax pre-check** (run the live checks from TS-1 before compiling and offer to skip a doomed build), and **recompile from scratch** (clean caches then build).
- **OL-3** A compact **issues badge** (for example "2 errors, 9 warnings") and a "Logs and output files" panel listing the generated artifacts (PDF, log, `.bbl`, `.blg`, `.aux`, and others) with reveal, open, copy path, and delete (with confirmation, path-safe).
- **OL-4** Layout presets: source and PDF side by side, PDF in a separate window or editor group, PDF only, source only, with a one-key toggle that remembers the choice per project.
- **OL-5** Detect the project's main document and compiler settings from files that online LaTeX services and other tools produce (`latexmkrc`, `.latexmkrc`, magic comments, and an optional project settings file) so an imported project builds correctly without manual setup.
- **OL-6** A configurable compile timeout with a clear message and a "keep waiting / stop" choice, and a sandboxing note in the documentation: builds run on the user's own machine with the user's TeX installation (`shell-escape` is off unless explicitly enabled per project and trusted workspace).

### 20.2 Visual (rich text) editing mode (OL-7 to OL-14)

A "Visual" mode lets authors write without seeing most markup, as in the visual editors of online LaTeX services, while the `.tex` file remains the single source of truth.

- **OL-7** Implement as a VS Code **custom text editor** (`CustomTextEditorProvider`) opened via "Reopen Editor With" or a toggle command, with the source editor remaining the default. Both views edit the same `TextDocument`, so undo, save, SCM, and other extensions work.
- **OL-8** Visual mode renders and edits: headings, paragraphs, emphasis (`\textbf`, `\textit`, `\emph`, `\underline`), lists, quotations, inline and display math (rendered), footnotes, citations and cross references as clickable chips with completion, figures with an image preview and caption editing, simple tables as a grid, theorem-like environments, comments, and links.
- **OL-9** **Opaque islands.** Any construct the visual editor does not model (custom macros, TikZ, complex tables, unrecognized environments, preamble content) is displayed as a read-only, syntax highlighted raw block that can be opened in the source view, and is preserved byte for byte. The visual editor must never drop, reorder, or reformat content it does not understand.
- **OL-10** **Minimal edits.** Each visual edit is translated to a minimal text edit on the document. **A document opened and saved in visual mode with no edits must be byte identical to the original** (tested on all fixtures and on a corpus of real documents). Edits must not reflow unrelated paragraphs.
- **OL-11** Toolbar and shortcuts for bold, italic, underline, headings, lists, math, link, citation, reference, figure, and table, plus a command to jump from the current visual position to the same source location and back.
- **OL-12** Virtualize rendering of long documents so a 200 page thesis opens in under 1 second and typing latency stays under the PERF-2 budget.
- **OL-13** Math in visual mode is rendered through the same local renderer as the live preview (TS-7) with the same stated caveat about approximation.
- **OL-14** The visual editor is an advanced feature with its own milestone and acceptance tests. If a document contains too much unsupported content, the editor must say so and offer the source view rather than degrade silently.

### 20.3 Comments and tracked changes (OL-15 to OL-22)

- **OL-15 Comments.** Anchored comment threads on a range of text, with replies, resolve/reopen, an author name from configuration, timestamps, and a review sidebar listing open and resolved threads. Use the native VS Code Comments API for the in-editor experience.
- **OL-16 Storage.** Store review data in a plain, merge friendly, human readable sidecar inside the workspace (for example `.latexdesk/review/*.json`), so it can be committed to version control and shared. Optionally support portable in-source comment markers (`% [Alice] ...`) as an alternative storage mode for teams that prefer everything in the `.tex` files.
- **OL-17 Anchoring.** Anchors must survive edits: store the quoted text plus context, re-resolve after changes with exact then fuzzy matching, and mark a thread as "detached" with a way to re-anchor rather than silently pointing at the wrong text.
- **OL-18 Tracked changes.** A "track changes" mode records insertions and deletions made in the editor as suggestions with author and time, shown as decorations, with accept, reject, accept all, reject all, and per-author filtering.
- **OL-19** Tracked changes cover edits made inside VS Code only. Edits made by other tools while track mode was on are not tracked as suggestions, and this limitation must be documented. A "compare with snapshot or git revision" command (OL-23) is the complementary mechanism for untracked edits.
- **OL-20** Export suggestions as markup for common change-tracking packages (`changes`, `trackchanges`) and generate a **latexdiff** document comparing the current text with any snapshot, git revision, or file, building the diff PDF through the normal build system when `latexdiff` is installed.
- **OL-21** Review state must never alter the compiled document unless the user explicitly exports markup.
- **OL-22** Review data must be robust: a malformed sidecar must not prevent the editor from opening the file, and a repair path must exist.

### 20.4 Project history and versions (OL-23 to OL-27)

- **OL-23** Provide automatic **local snapshots** (on successful build, on a configurable idle interval, and before bulk operations) stored in a space-limited, compacted, content-addressed store outside the working tree (or inside `.latexdesk/` and git-ignored), with named **labelled versions** ("Submitted to journal, v1"). Per-file and whole-project restore, with diff against the current text through VS Code's diff editor.
- **OL-24** If the project is a Git repository, integrate with it rather than duplicate it: show a history view that merges snapshots and relevant commits for the active file, and allow labelling a commit.
- **OL-25** Snapshot storage limits (count, age, total size) are configurable, and the storage location is shown in settings. Restoration must never overwrite without confirmation and must itself create a snapshot of the pre-restore state.
- **OL-26** Compare any two versions, including PDF page diffs for a labelled version pair where both PDFs were stored (opt in because of size).
- **OL-27** Snapshots must be safe in multi-root workspaces and must exclude generated files, `.git`, and configured large binary paths.

### 20.5 Images, templates, and project files (OL-28 to OL-34)

- **OL-28 Paste or drop an image.** Pasting an image from the clipboard, or dropping an image file, into a LaTeX file saves it into the configured figures folder (unique, sanitized file name; optional format conversion and downscaling), and inserts a complete `figure` environment (or plain `\includegraphics`) with caption and label placeholders and the right relative path. Use the VS Code document paste and drop APIs. Support PNG, JPEG, PDF, and SVG (SVG through an optional converter, with a clear message if it is not installed). Never overwrite an existing file.
- **OL-29 Templates gallery.** A local gallery of original, bundled templates (article, report, book, beamer presentation, letter, CV, poster, thesis skeleton, conference-style generic, and a BibLaTeX example), plus user templates from a folder, plus "create project from this ZIP or folder". Provide "Save project as template". Fetching templates from a URL is user initiated and shows the source before extraction. Do not bundle publisher templates whose licenses forbid redistribution; link instead.
- **OL-30** Project actions in the explorer and the sidebar: new file, new folder, rename and move with automatic update of references (TS-20), duplicate, upload (copy files in), and download as ZIP.
- **OL-31 Error explanations.** See the log parsing section: friendly explanations and fix suggestions for common errors, shown at the problem and via an "Explain this error" command.
- **OL-32 Submission and archive export.** "Export for submission" produces a clean ZIP or folder containing only the files actually needed, with options: flatten includes, inline the bibliography as a pre-generated `.bbl` for services that require it, strip comments, remove `%` review markers, rewrite absolute paths, include the compiled PDF, and add a manifest. Then **verify** by compiling the exported copy in a fresh temporary directory and reporting any failure. Provide an arXiv oriented preset that warns about common arXiv pitfalls (missing `.bbl`, forbidden file types, case sensitive file name collisions, spaces in names, oversized figures).
- **OL-33** "Download project as ZIP" and "import ZIP" with safe extraction (reject path traversal and absolute paths, size and file count limits).
- **OL-34** A **project dashboard** view showing the root, build state, issue counts, bibliography health, word count, TODO count, and last snapshot, so the author sees project readiness at a glance.

### 20.6 Online LaTeX service interoperability (OL-35 to OL-39)

Interoperate only through documented, supported mechanisms.

- **OL-35** Import and export projects in the standard ZIP layout used by online LaTeX services, preserving file structure, and mapping project settings that can be inferred (main document, compiler) as in OL-5.
- **OL-36** **Git workflow helper.** Where the user's plan with an online LaTeX service, or a self-hosted installation, provides Git access, support "Clone hosted project" using the project's Git URL, with credentials supplied through VS Code authentication or `SecretStorage` (never stored in settings or logs), plus guided pull, push, and conflict resolution that leans on VS Code's Git integration. The documentation must state that availability depends on the user's plan or server edition.
- **OL-37** Self-hosted instances of an online LaTeX service use the same Git or ZIP routes with a configurable base URL.
- **OL-38** Never call or emulate undocumented web endpoints of an online LaTeX service, and never store the user's password for such a service. State this limitation in the documentation.
- **OL-39** When two-way sync is not possible, make that clear and degrade to import/export, rather than implying live synchronization.

### 20.7 Real time collaboration (OL-40 to OL-47) — Tier 2

Collaboration is a separable, feature-flagged module (`latexdesk.collaboration.enabled`, default false) with its own milestone. It must not add cost to the single user path.

- **OL-40** First guarantee compatibility with **VS Code Live Share** for hosts and guests: providers and views must degrade gracefully in guest sessions, and the documentation must list what works.
- **OL-41** Provide an optional built-in collaboration mode using a conflict-free replicated data type (for example Yjs) for text, with presence (names and colored cursors/selections), follow mode, and per-user undo.
- **OL-42** Transport is a small, **self-hostable relay server** shipped in the repository (Node, WebSocket) with room tokens, optional end-to-end encryption using a key carried in the invite link and never sent to the server, and no persistence of document contents on the relay unless the host enables it. No third-party hosted service is used by default.
- **OL-43** A host-compiles model: the host builds and the guests can view the resulting PDF and diagnostics, with the option for guests to build locally.
- **OL-44** Offline resilience: edits made while disconnected merge on reconnect, with no silent loss; the user is told when a merge changed their text.
- **OL-45** Respect workspace trust and file permissions: guests only access files the host shares, and path traversal is rejected.
- **OL-46** Security review items: token generation, expiry and revocation, rate limiting, maximum room size, input validation of every message, and a documented threat model.
- **OL-47** Collaboration must be tested with multiple simulated clients for convergence, including concurrent edits, reconnects, and large pastes.

### 20.8 Sharing, publishing, and templates (OL-48 to OL-58)

These features prepare a project for the people who receive it (publishers, co-authors, reviewers) and start new projects from a shared template library.

- **OL-48 Source ZIP for publishers.** "Create Source ZIP" (in the Build view, the compile menu, and the command palette) writes one ZIP file with every source file of the project folder and nothing that the build produced, so that the author can send a single compressed file to a publisher or a co-author. Rules:
  - The root document's folder is walked recursively and the folder structure is kept inside the ZIP.
  - Excluded: the compiled PDF (any `X.pdf` that sits next to an `X.tex`, and every PDF in the output directory); build output by extension (the list used by Clean, plus `.synctex.gz`, `.synctex(busy)`, `.fdb_latexmk`, `.fls`, `.xdv`, `.dvi`); the output directory when it is a sub folder; the extension's own folder (`.latexdesk`); version control and editor folders (`.git`, `.svn`, `.hg`, `.vscode`, `.idea`); `node_modules`; operating system files (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX`); editor backups (`*~`, `*.bak`, `*.swp`); and ZIP files, so that an earlier export is never packed into the next one.
  - Kept: everything else, including PDF, EPS and PNG figures, `.bib`, `.bst`, `.cls`, `.sty`, data files, and a pre-generated `.bbl` only when the user asks for it (off by default, because publishers that run BibTeX themselves do not want it).
  - Symbolic links that point outside the project folder are skipped and reported.
  - The default file name is `<job>-source.zip` in the project folder (chosen in a save dialog). The result notification states the number of files and the size, lists what was left out by category, and offers "Reveal" and "Verify", which compiles the ZIP's contents in a fresh temporary folder exactly like OL-32.
  - The "Full project" preset of Export for submission (OL-32) uses the same file selection, so both paths produce the same archive.
- **OL-49 Watermarked PDF.** "Export PDF with Watermark…" (in the Build view, the compile menu, the PDF viewer's title bar, and the command palette) writes a copy of the last built PDF with a text watermark on every page. It never changes the built PDF or any source file, needs no rebuild, and adds no package to the document.
  - The user enters the text (default `DRAFT`, then the last text used) and picks a placement: diagonal across the page (default), across the top margin, or across the bottom margin. The opacity comes from `latexdesk.watermark.opacity` (default 0.15).
  - The watermark is light grey, centred, scaled to the page size, and drawn above the page content so that it cannot be hidden by full-page figures. It is real text, so readers can still select and search the page text.
  - The output defaults to `<job>-watermarked.pdf` next to the built PDF (chosen in a save dialog). Writing over the built PDF is refused.
  - The PDF is processed in the extension with **pdf-lib** (MIT licence), loaded only when the command runs (PERF-1). The text is set in a standard PDF font, so this version accepts Latin characters only (the WinAnsi character set); any other character produces a clear message that suggests the LaTeX route below.
  - Why post-processing rather than a LaTeX package: it works with every class and engine, needs no rebuild of a long document, keeps the sources (and therefore the submission archive) free of review-only code, and gives the watermarked copy and the clean PDF side by side. Authors who want a watermark in every build keep using a LaTeX package such as `draftwatermark` or `background` in their preamble; the extension does not add one for them.
- **OL-50 Create from Template.** "Create from Template…" in the Build view (also in the Build view's welcome content when the workspace has no LaTeX root document), in the compile menu, and in the command palette opens the **Template Gallery**, a webview panel. The gallery also offers "Blank project" (the quick start wizard, TS-10) and "From a ZIP file on disk…".
- **OL-51 Template catalog.** The gallery reads a catalog file, `templates.json`, from `latexdesk.templates.catalogUrl`, by default `https://raw.githubusercontent.com/esquaredsystems/latexdesk-resources/master/templates/templates.json`. The catalog is a JSON object `{ "version": 1, "updated": "<date>", "templates": [ ... ] }`, ordered from most used to least used. Each template has:

  | Field | Required | Meaning |
  | --- | --- | --- |
  | `id` | yes | Unique, lowercase letters, digits and `-`; also the default folder name |
  | `name` | yes | Display name |
  | `type` | yes | `journal`, `conference`, `thesis`, `book`, `report`, `article`, `presentation`, `poster`, `cv`, `letter`, or `other` |
  | `publisher` | no | Publisher, society, or conference |
  | `description` | no | One or two sentences shown in the gallery and searched |
  | `tags` | no | Subject areas and keywords, searched |
  | `filename` | no | The template's ZIP file, relative to the catalog URL (or an absolute `https` URL). Without it the template is shown as "available from the publisher" |
  | `main` | no | The root document inside the ZIP |
  | `engine` | no | `pdflatex`, `xelatex`, or `lualatex` |
  | `bibliography` | no | `bibtex`, `biber`, or `none` |
  | `requires` | no | Classes and packages the template expects from the TeX distribution |
  | `license` | no | The licence of the ZIP's contents |
  | `source` | no | The official page the template comes from |

  Unknown fields are ignored; entries with a missing required field or a repeated `id` are skipped and counted in the gallery's status line. A catalog with a `version` greater than the one the extension understands is still shown, with a note to update the extension.
- **OL-52 Fetching and caching.** The catalog is downloaded only when the user opens the gallery (and at most once an hour, or on "Refresh"), with a 10 second timeout and a 5 MB limit, and is cached in the extension's global storage. Offline, the cached copy is shown with the date it was fetched; with no usable catalog (no cache, no network, or a file that is not valid JSON), only the local options (blank project, ZIP on disk) are shown.
- **OL-53 Search for large catalogs.** The catalog will grow to thousands of templates, so the gallery's search must stay instant:
  - Results update as the user types (within 50 ms for 10,000 templates on the reference environment), searching the name, publisher, type, tags, and description, case and accent insensitive.
  - Every word of the query must match (so `ieee conference` narrows rather than widens); each word also matches as a prefix (`spring` finds Springer).
  - Ranking: a match in the name counts most, then the publisher, tags, type, and description; a word that starts a word of the name counts more than one found inside it; ties keep the catalog order (most used first).
  - Type filter chips (All, Journal, Conference, Thesis, Book, …) show counts for the current search. A sort control offers Most used (the default with an empty search), Best match (the default while searching), and Name.
  - Results are shown 50 at a time with "Show more", and the matching words are highlighted.
  - Keyboard: typing anywhere goes to the search box, `↓` and `↑` move through the results, `Enter` creates a project from the selected template, and `Escape` clears the search.
  - An empty result explains itself ("No template matches …") and offers the blank project and the ZIP on disk.
- **OL-54 Template details.** The selected result shows its name, publisher, type, description, tags, engine, bibliography tool, required classes, licence, and a link to its official source. A template without a ZIP offers "Get from publisher" (opens the source page in the browser) and "Create from a downloaded ZIP…".
- **OL-55 Creating the project.** The user picks a parent folder and a project folder name (default: the template `id`); an existing, non-empty folder is refused. The ZIP is downloaded over `https` only (60 second timeout, 50 MB limit) with a cancellable progress notification and extracted with the safe extraction rules of OL-33: absolute paths, drive letters and `..` segments are rejected; `__MACOSX`, `._*` and `.DS_Store` entries are skipped; a single top-level folder is removed so that the files land in the project folder; at most 2,000 files and 200 MB are written. The root document is the catalog's `main`, otherwise `main.tex` when it has `\documentclass`, otherwise the first `.tex` file with both `\documentclass` and `\begin{document}`. The user then chooses to open the new folder in the current window or a new one, and the root document is opened in the editor once the folder is open.
- **OL-56 Required classes.** When a template lists `requires` and `kpsewhich` cannot find one of them, the extension says so after creating the project and shows the install command for TeX Live or MiKTeX, as in TS-32. It never installs software.
- **OL-57 Privacy.** Only the catalog URL and the ZIP URLs named in the catalog are contacted, only after a user action, and nothing is sent beyond the HTTP request itself. `latexdesk.network.enabled` set to `false` turns the download off (the gallery then shows the cached catalog and the local options). The template catalog is listed in the network inventory and in the privacy document.
- **OL-58 Resources repository.** The catalog and the ZIP files live in the public repository `esquaredsystems/latexdesk-resources` under `templates/`, next to each other. A template ZIP holds the files of a project at its top level (or inside a single folder). A template is added as a ZIP only when its licence allows redistribution; otherwise its entry has no `filename` and points to the publisher (OL-29). Templates written for the library itself contain only original starter files and rely on the class from the user's TeX distribution. The repository provides a check script that validates the catalog (required fields, unique ids, known types, existing ZIP files, `https` sources) and compiles each template's ZIP.

## 21. Views, menus, status bar, and keyboard shortcuts

Provide a polished, native VS Code experience.

### Sidebar

Include a dedicated LaTeX project view with appropriate sections for:

- Build actions.
- Build recipes.
- Project structure.
- Included files.
- Bibliography and citations.
- Labels and references.
- Build errors and warnings.
- Generated PDF files.

Do not crowd the interface with redundant controls.

### Status bar

Display relevant information such as:

- Current root document.
- Build state.
- Active build recipe.
- PDF viewer state.
- Last build result.
- Outstanding build errors.

Keep the status bar compact and avoid constant noisy notifications.

### Context menus

Provide useful context actions for `.tex` and `.bib` files, source selections, build output, and PDF documents.

Allow users to disable context menu contributions if desired.

### Keyboard shortcuts

Define sensible platform appropriate shortcuts for:

- Build.
- View PDF.
- Forward SyncTeX.
- Stop compilation.
- Clean auxiliary files.
- Choose build recipe.
- Insert an environment.
- Wrap selection.
- Navigate between errors.
- Open the citation browser.
- Refresh the PDF.

Avoid conflicting with standard VS Code shortcuts. Make bindings discoverable and configurable.

### Additional sidebar sections and views

In addition to the sections above, provide, each lazily created:

- **Bibliography Health** (scanner summary, duplicates, uncited, unresolved).
- **TODO and Bookmarks**.
- **Symbols and Quick Insert** (symbol palette, math toolbar).
- **Review** (comment threads, tracked changes).
- **History** (snapshots and labelled versions).
- **Project Dashboard** (readiness overview).
- **Spelling** (issues in the current file, dictionaries).
- **Search Results** for project-wide find and refactoring previews.

Also provide: the Bib Manager and visual editor as custom editors; status bar items for compile state and issue counts, spell language, and review mode; editor title actions for build, view PDF, and visual/source toggle; and CodeLens (configurable) for build-this-environment, citation counts in `.bib` files, and label reference counts.

### Additional keyboard shortcuts

Define shortcuts for: fast preview build; toggle PDF layout; toggle visual/source mode; open the symbol palette; open the bibliography search; scan the current bibliography; add comment; toggle track changes; jump to matching `\begin`/`\end`; promote and demote section; next and previous issue. Provide an optional keymap preset that mimics shortcuts common in desktop LaTeX editors, documented in a migration guide, and never override VS Code defaults without the user's choice.

## 22. Configuration system

Expose a complete, validated set of extension settings through VS Code's settings interface.

Organize settings into logical groups:

1. Project discovery.
2. Build tools.
3. Build recipes.
4. Compilation triggers.
5. Output and auxiliary directories.
6. Root document selection.
7. PDF viewer.
8. SyncTeX.
9. Completion and language intelligence.
10. Snippets and editing behavior.
11. Formatting and linting.
12. Diagnostics.
13. Sidebar and status bar.
14. Logging and troubleshooting.
15. Advanced performance settings (worker count, cache location and limits, debounce intervals, memory caps, fast build modes).
16. Bibliography (dialect, profile, rule severities, formatting style, key template, enrichment, Zotero).
17. Spelling and grammar.
18. Review, history, and templates (including `latexdesk.templates.catalogUrl`), and export (`latexdesk.watermark.opacity`).
19. Visual editor.
20. Collaboration.
21. Network and privacy (a master switch, `latexdesk.network.enabled`, plus one switch per networked feature).

Provide three one-click presets, **Fast**, **Balanced**, and **Low resource**, that set the performance related settings together. All settings must have clear descriptions, defaults, scope, and markdown documentation, and be searchable by tags.

Support user, workspace, and folder scoped configuration where applicable.

Provide defaults that work for common installations but do not assume a single operating system or TeX distribution.

Validate recipes and paths before use. Explain invalid settings with actionable messages.

Do not overwrite user settings during extension upgrades.

Document the configuration schema and provide realistic examples.

## 23. Platform and environment compatibility

### Windows

Support executable paths with spaces, Windows path separators, process termination, common MiKTeX and TeX Live installations, and appropriate external PDF applications.

### macOS

Support Apple Silicon and Intel systems where the selected Node and native dependencies permit.

Support MacTeX and TeX Live installations and executable discovery in common locations.

Handle GUI application environments in which the extension's PATH differs from the interactive shell.

### Linux

Support common TeX Live installations, standard executable discovery, and common external PDF viewers.

### Remote environments

Work with VS Code Remote SSH, WSL, development containers, and remote workspaces where supported by the extension architecture.

Run compilation in the environment that owns the source workspace, not automatically on the local desktop.

Explain which PDF viewing and synchronization components run locally and which run remotely.

Do not assume that a local executable or absolute path is accessible to a remote extension host.

### Virtual and web workspaces

Declare supported behavior for virtual workspaces and the web explicitly. In the first release, virtual and web workspaces may be limited to read-only intelligence that needs no external process; the environment-agnostic core is designed so that this can be extended later.

### Remote notes for the new features

Worker threads, indexing, spell checking, the bibliography scanner, and the SyncTeX index run in the extension host that owns the workspace. Webviews run locally. Local-only integrations, such as a Zotero bridge on the user's desktop, must explain clearly when they cannot be reached from a remote extension host.

## 24. Performance, reliability, and security

Treat performance and reliability as requirements, not optional refinements.

- Keep expensive parsing and indexing work out of the extension host's synchronous event path.
- Use cancellation tokens and debouncing.
- Avoid full workspace rescans after every keystroke.
- Cache parsed documents using file modification metadata or content hashes.
- Invalidate caches when relevant dependencies change.
- Limit memory usage when indexing large projects.
- Dispose of file watchers and child processes.
- Recover from malformed TeX and BibTeX input.
- Handle deleted files and changed workspaces.
- Avoid infinite recursion and cyclic dependency loops.
- Do not send source code, bibliography contents, or manuscript data to external services. The only exceptions are the explicitly listed, opt in, user initiated integrations in the network inventory below, which send the minimum data necessary (for example only an identifier, or only the prose of the selection).
- Do not introduce telemetry without explicit, documented consent and a suitable opt out.
- Do not execute arbitrary commands embedded in source files.
- Do not automatically install system software.
- Do not run shell commands assembled by concatenating untrusted source content.
- Use secure webview messaging and validate messages received from webviews.
- Restrict webview content security policy.
- Validate paths before cleanup or deletion.
- Avoid following unsafe paths outside configured project boundaries when cleaning generated artifacts.

External tools must be invoked according to user supplied configuration and documented build recipes.

### Network inventory and privacy

Maintain a single, documented **network inventory** (in the README and in a command that shows it). Each entry lists the feature, the endpoint, exactly what data is sent, when it is sent, the default (off unless stated), and how to disable it. Initial inventory:

| Feature | Destination | Data sent | Default |
| --- | --- | --- | --- |
| DOI, arXiv, ISBN, PubMed metadata lookup | Crossref, arXiv, Open Library, NCBI (configurable) | The identifier being resolved, plus an optional user supplied contact email | Off until the user runs the command and accepts a one-time notice |
| Retraction check | Documented public data source | The DOI | Off |
| Dictionary download | Configured dictionary source | None beyond the request; verified by pinned checksum | Off until the user picks a language |
| Grammar check | Local or user configured LanguageTool server | Prose of the checked text | Off; a remote server requires an explicit privacy acceptance |
| Template download by URL | The URL the user entered | None | Off |
| Template catalog and template ZIPs (OL-52, OL-55) | `latexdesk.templates.catalogUrl` (default: raw.githubusercontent.com, repository `esquaredsystems/latexdesk-resources`) and the ZIP URLs it lists | None beyond the HTTP request | Only when the user opens the Template Gallery or creates a project from it |
| Zotero | Loopback (local), or Zotero web API with a user key | Search text | Off |
| Online service Git interoperability | The user's Git remote | Git protocol data | Off |
| Collaboration relay | Self-hosted relay chosen by the user | Encrypted editing operations | Off |

A master "Disable all network features" setting must exist and be honored by every feature. No telemetry is collected by default; if usage or crash telemetry is ever added it must be opt in, documented, and minimal. Secrets (tokens, API keys, passwords) are stored only in VS Code `SecretStorage`, never in settings, logs, snapshots, or exported archives.

### Additional security requirements

- Honor VS Code workspace trust for running external tools, shell escape, macros, and any configuration that executes programs.
- Extract archives (project ZIPs, templates, dictionaries) safely: reject path traversal, absolute paths, symbolic link escapes, and enforce size and file count limits.
- Verify downloaded dictionaries and templates against pinned hashes or user confirmation of the source before use.
- Validate every webview message and every collaboration message against a schema; treat all of them as untrusted input.
- Keep third party dependencies minimal, pinned by lockfile, license checked, and audited in CI.
- Redact file paths and secrets from shareable troubleshooting reports unless the user opts to include them.

## 25. Error handling and troubleshooting

Provide a dedicated output channel and structured logging.

Every user facing failure should provide useful context and a practical next step.

Examples include:

- No TeX compiler installed.
- Compiler not found on PATH.
- Invalid build recipe.
- Compilation failed.
- PDF not generated.
- PDF cannot be opened.
- SyncTeX metadata missing.
- Bibliography file missing.
- Citation key unresolved.
- Root document ambiguous.
- Formatting executable unavailable.
- Invalid configuration.
- Child process terminated unexpectedly.
- Build cancelled.
- Output directory inaccessible.
- Bibliography scan could not parse a file, or a profile file is invalid.
- Metadata lookup failed, was rate limited, or the service was unreachable (with offline cache information).
- Zotero is not running or is unreachable from a remote host.
- Dictionary missing for the requested spelling language.
- Snapshot store full or unwritable.
- Collaboration disconnected, token expired, or relay unreachable.
- A cache was found corrupt and rebuilt.

Distinguish actionable errors from informational messages.

Do not suppress important compiler output.

Avoid repeated modal popups for the same ongoing issue. Prefer diagnostics, status indicators, and output channels where appropriate.

## 26. Testing requirements

Build a serious test suite covering pure logic, VS Code integration, external process execution, and end to end behavior.

### Unit tests

Test:

- Root file detection.
- Magic comment parsing.
- Include dependency extraction.
- Nested includes.
- Circular includes.
- Citation extraction.
- BibTeX and BibLaTeX parsing.
- Label extraction and duplicate detection.
- Command and environment completion.
- Outline construction.
- Log parsing.
- Diagnostic location mapping.
- Recipe expansion and variable substitution.
- Output path resolution.
- Process cancellation logic.
- Cleanup path safety.
- Incremental index invalidation.
- Bibliography parser: round trip byte identity, error recovery, string macros, crossref inheritance, and total behavior on fuzzed and binary input (property based tests and a fuzz corpus).
- Bibliography scanner: every rule in the rule catalogue has at least one positive and one negative test; BibTeX and BibLaTeX required field tables are verified entry type by entry type; duplicate detection precision and recall measured on a labelled fixture; completeness score formula; suppression comments; and parity between the CLI and the extension.
- Bibliography editing: minimal text edits (unchanged regions untouched), idempotent formatting, key rename across a project, dialect conversion, and merge.
- Incremental TeX scanner: results after any sequence of edits equal results of a full re-parse (differential and randomized edit tests).
- SyncTeX reader versus the real `synctex` tool on real files.
- Spell checker LaTeX awareness (commands, math, labels, verbatim excluded; language switching).
- Review anchoring after edits, snapshot store compaction and restore safety, safe archive extraction, and macro trust rules.
- Log parser streaming equivalence (parsing in chunks equals parsing the whole log) and friendly explanation matching.
- Duplicate package detection and its quick fix (single name, name in a comma list, across files, options that differ).
- Source ZIP selection: every excluded category, figures kept, compiled PDF left out, output sub folder left out, links outside the folder skipped.
- Watermarking: page count and page sizes unchanged, the watermark text present on every page, non-Latin text refused with a message.
- Template catalog parsing (invalid and repeated entries skipped, unknown fields ignored), search ranking and AND semantics, the 10,000 template search budget, and safe template extraction (path traversal, `__MACOSX`, single top folder, limits).

### Integration tests

Use temporary projects containing realistic LaTeX source files and bibliography files.

Test:

- Activation in a workspace.
- Command registration.
- Building a project through a fake compiler.
- Capturing output and exit codes.
- Updating diagnostics.
- Automatic builds after source changes.
- Switching root files.
- Selecting a recipe.
- Opening the generated PDF.
- Viewer refresh after rebuild.
- Correct cleanup behavior.
- Bib Manager custom editor round trips with the text editor, with undo and redo.
- Visual editor: opening and saving an unedited document yields byte identical text; edits produce minimal changes; opaque islands survive.
- Paste and drop of an image producing a figure and a unique file.
- Event loop delay stays under the PERF-20 limit during indexing, scanning, and building.
- Enrichment with recorded service responses (no live network in CI); live service tests are separate, opt in, and not part of required CI.
- Collaboration convergence with multiple simulated clients, reconnects, and concurrent edits.
- Webview and collaboration message validation against malformed and hostile messages.

Use fake executables or controlled fixtures for tests that must run without a TeX distribution.

### End to end tests

Where the environment permits, run real builds using an installed TeX distribution.

Include examples using `pdflatex`, `xelatex`, or `lualatex`, as available.

Test bibliography compilation and SyncTeX with real generated PDFs.

Include multi file documents, nested chapter files, malformed source, missing bibliography entries, and paths containing spaces.

The Dissertation build gate defined in the acceptance criteria section is the capstone end to end test and must run, where the fixture is present, as part of the hardening milestone and before every release.

Test on Windows, macOS, and Linux through CI where feasible.

Do not mark a feature complete merely because its code compiles.

### Performance tests

Provide automated benchmarks for every budget identifier in the Performance requirements section, run against the benchmark corpora, with stored baselines and a regression gate, as specified there. A feature is not complete until its budget is measured and met or an honest, documented exception is recorded in the final report.

## 27. Sample fixtures

Create a test workspace containing:

- `main.tex`
- `chapters/introduction.tex`
- `chapters/methodology.tex`
- `references.bib`
- `figures/`
- A file with undefined references.
- A file with a duplicate label.
- A file with malformed syntax.
- A project with multiple root documents.
- A project using `\include` and `\input`.
- A project using BibLaTeX and Biber.
- A project with a subfile.
- A project using XeLaTeX or LuaLaTeX.
- A project with spaces in directory names.

Use these fixtures to demonstrate and verify actual functionality.

### The Dissertation fixture

The author's thesis in `thesis/` is a first-class, read-only real-world fixture, used for the final validation gate, as the Thesis benchmark corpus, and as an input to the bibliography scanner, spell checker, and structure tests. Known properties that the tool must handle (verified against the supplied files, and re-verified by a script at the start of the gate rather than assumed):

- **Root and structure.** The root document is `main.tex`. It uses `\documentclass[a4paper,10pt,times,numbered,print,index]{PhDThesisPSnPDF}` with the class file `PhDThesisPSnPDF.cls` stored beside it, then `\input{preamble}` and `\input{document-info}`. Front matter, seven chapter files (`chapter-intro`, `chapter-domain`, `chapter-related`, `chapter-proof`, `chapter-experiment`, `chapter-framework`, `chapter-conclusion`), and appendices (`glossary`, `appendix-B`, `appendix-C`, `appendix-C2`) are brought in with `\include`, inside `appendices` and `spacing` environments. Some includes are commented out (for example `dedication`) and must not be treated as dependencies. Root detection must choose `main.tex` without asking, and must not mistake any other file for a root.
- **Bibliography.** `references.bib` (about 86 KB, Unicode) is used through `\bibliographystyle{unsrt}` and `\bibliography{references}` inside a `spacing` and `small` group, with `natbib` loaded through the class or preamble (numbered option). The back end is **BibTeX**, not Biber.
- **Index and other generated lists.** The class provides `\printthesisindex` (index option on), a table of contents, list of tables, list of figures, and list of algorithms; `nomencl` is loaded by the class but its printing is commented out. The thesis's own `compile-thesis.sh` documents the intended sequence: `pdflatex`, `bibtex`, `makeindex` on the index, `pdflatex`, `pdflatex`. The tool's recipe must reach an equivalent result, including generating the index, with no manual steps.
- **Graphics.** About 357 `\includegraphics` calls (356 unique names) resolve through `\graphicspath{{Figs/Raster/}{Figs/PDF/}{Figs/}}`. The figure files have now been supplied: `Figs/` holds 446 files (about 14 MB: 437 PNG, 6 JPEG, 1 PDF, 2 EPS), placed directly in `Figs/`. A script check found that every active reference resolves; the only two names that do not resolve (`University_Crest_Long` and `CollegeShields/Kings`) occur in lines commented out with `%` in `document-info.tex`, so a correct tool must not report them as missing graphics, and this is a regression test for comment handling. `University_Crest` exists as both `.pdf` and `.eps`; with `pdflatex` the tool's graphics resolution and any hover preview or missing-file check must agree with what the engine actually picks (the PDF), and must not demand an EPS conversion. Because most figures are large PNGs, this is also the realistic workload for image decoding time, the draft graphics fast preview, and the viewer's memory budget. The tool must still handle the absence of figures gracefully (Gate A) for other machines and for fresh clones that lack them.
- **Encoding and line endings.** Source files mix pure ASCII and UTF-8; several files (`appendix-B`, `appendix-C`, `appendix-C2`, `chapter-conclusion`, `chapter-framework`, `chapter-proof`) use Windows (CRLF) line endings while others use LF. Parsers, edits, SyncTeX line mapping, and the visual and bibliography editors must handle both without altering untouched lines or converting line endings.
- **Very long lines.** Several source lines exceed 600 to 1,400 characters; the editor, scanner, and spell checker must stay within budget on them.
- **Legacy artifacts.** The folder contains an older `main.pdf` (254 A4 pages, produced in December 2022 by pdfTeX through MiKTeX), a `main.synctex.gz`, and an empty `main.idx`. These are the author's reference output. The tool must never overwrite or delete them without first creating a recoverable snapshot (see the safety rules in the gate).
- **Non source files** such as `smart-art-objects.docx`, `.DS_Store`, `README.md`, and the Windows batch file must be ignored by indexing and never treated as dependencies.

### Additional fixtures for the new features

- Bibliography fixtures: a clean file; an incomplete file (one case of every required field rule); duplicate keys and duplicate works (same DOI, same title with different keys, near duplicates that are *not* the same work); malformed files (unbalanced braces, truncated entry, missing comma, stray text, binary content); BibLaTeX aliases (`date`, `journaltitle`, `location`, `ids`); `crossref` and `xdata` inheritance; `@string` and month macros; Unicode versus LaTeX accents; a placeholder values file; invalid DOI, ISBN, ISSN, and URL cases; CRLF and BOM variants; the 10,000 entry stress file and its malformed variant (generated deterministically).
- A manuscript that cites existing, missing, incomplete, and uncited entries across several chapters and two bibliographies.
- A multilingual document (English, German, and French sections with `babel`) for the spell checker, containing misspellings only in prose.
- A project with review sidecars (attached, edited-away, and detached anchors) and a history of snapshots.
- A visual editor corpus: simple prose, lists, math, figures, tables, and documents with heavy custom macros and TikZ to exercise opaque islands.
- Benchmark corpora from the Performance requirements section.
- Recorded service responses for DOI, arXiv, ISBN, and PubMed lookups, including empty, ambiguous, and error responses.

## 28. Documentation and packaging

Produce:

1. A user-facing README that shows the product: a hero screenshot, short animations (GIF) of the main workflows, and screenshots of the main panels, all taken from the real extension running on a demo document. It covers getting started, features, shortcuts and settings, and leaves contributor material to the developer guide.
2. Installation instructions.
3. Supported platform and dependency information.
4. A first project tutorial.
5. Build and recipe configuration examples.
6. PDF viewer instructions.
7. SyncTeX setup and troubleshooting.
8. Completion and citation browser documentation.
9. Formatting and linting instructions.
10. A complete settings reference.
11. Keyboard shortcut documentation.
12. Known limitations.
13. Developer setup instructions, in a separate developer guide (`README_DEV.md`) for contributors to the repository, distinct from the README for users of the extension.
14. Test execution instructions.
15. VSIX packaging instructions.
16. A changelog, with an entry for every published version.
17. A clear license and an "Included software and data" section in the README (no separate notices file), including provenance of every bundled data set (symbols, package metadata, journal abbreviations, error explanations, templates, dictionaries).
18. A bibliography editor guide with the complete rule reference: every scanner rule code, what it checks, why it matters, severity defaults, and examples of the quick fix.
19. Performance documentation: the budgets, how to run the benchmarks, how to read the results, and the measured table for the release.
20. A migration guide for users of desktop LaTeX editors (concept and shortcut mapping, including the optional keymap preset).
21. A migration guide for users of online LaTeX services (workflow mapping, import and export, Git route, visual mode).
22. A privacy document with the network inventory.
23. An architecture document describing the packages, worker model, index, and cache design.
24. Collaboration server deployment and security documentation.

**Images on the Marketplace.** The Marketplace and VS Code's extension page load README images from the web as an anonymous visitor, and the source repository is private. Therefore:

1. The README refers to images, `docs/` pages, the licence and the developer guide with relative paths, so they work when browsing the source repository.
2. Copies live in the `latexdesk/` folder of the public repository `esquaredsystems/latexdesk-resources`, kept apart from that repository's own licence.
3. `npm run package` passes `--baseImagesUrl https://raw.githubusercontent.com/esquaredsystems/latexdesk-resources/master/latexdesk` and `--baseContentUrl https://github.com/esquaredsystems/latexdesk-resources/blob/master/latexdesk` to `vsce`, so the packaged README points at the public copies.
4. New or changed images and linked documents are copied there and pushed **before** a version is published. Images are not shipped inside the `.vsix`.

Provide sample `settings.json` configurations for Windows, macOS, and Linux where their differences matter.

Document which features work without optional external tools and which require additional installations.

## 29. Implementation milestones

Implement the project in the following order, preserving a working extension at every milestone. Performance work is not a final polishing phase: every milestone must meet the budgets that apply to it before it is considered complete, and the benchmark harness exists from Milestone 1.

### Milestone 1: Foundation and measurement

Set up the workspace packages (core, cli, extension, webviews), strict TypeScript configuration, bundler, activation lifecycle, lazy loading, command registration, settings, logging, tests, packaging, the benchmark corpus generator and harness, and the event loop delay monitor.

Deliverable: an installable extension that activates in under 50 ms (PERF-1) and a benchmark command that reports baseline numbers.

### Milestone 2: Core engine and project model

Implement the worker pool, the incremental error tolerant TeX scanner, the persistent index cache, query indexes, root detection, multi file dependency indexing, magic comments, workspace discovery, and incremental updates.

Deliverable: correct root and dependency information for realistic projects, meeting PERF-2, PERF-3, PERF-7, and PERF-8.

### Milestone 3: Build engine

Implement configurable tools, recipes, process execution, compilation, cancellation, output capture, the smart pass engine, stable PDF detection, supersede policy, automatic builds, and cleanup.

Deliverable: real LaTeX compilation from the command palette, meeting PERF-12, PERF-B1, PERF-B5, and PERF-B6. From this milestone on, run the Dissertation gate (Gate A, structural build) at the end of every milestone and record the result, so that problems with the real thesis are found early instead of at the end.

### Milestone 4: Diagnostics

Implement streaming log parsing, source location mapping, VS Code problems, the friendly error explanation knowledge base, bibliography tool log mapping, and actionable error reporting.

Deliverable: compiler errors and warnings appear at the correct source locations during the build, with explanations, meeting PERF-11.

### Milestone 5: PDF viewing

Implement the internal PDF viewer with worker rendering, flicker free refresh, scroll anchoring, layouts, search, navigation, and external viewer integration.

Deliverable: real generated PDFs can be viewed and navigated, meeting PERF-13 and PERF-14.

### Milestone 6: SyncTeX

Implement the in-process SyncTeX reader, forward and reverse synchronization, and differential tests against the real `synctex` tool.

Deliverable: reliable bidirectional navigation in a compiled multi file project, meeting PERF-15.

### Milestone 7: Language intelligence and live checks

Implement command, environment, citation, label, and file completion, hover, definition, references, rename, signature help, document links, semantic highlighting, and the live syntax and structure checks.

Deliverable: context aware editing assistance based on the actual project, meeting PERF-4 and PERF-5.

### Milestone 8: Bibliography parser, scanner, and editing language support

Implement the lossless incremental bib parser, the dialect model, the rule engine with all required, recommended, value, structural, duplicate, and project cross check rules, the completeness score, diagnostics, quick fixes, bib language features (grammar, completion, hover, symbols, folding), the report view, and the headless CLI.

Deliverable: scanning and editing `.bib` files with trustworthy diagnostics, meeting PERF-9 and PERF-10, with round trip identity and CLI parity tests passing, and with the scanner run over the thesis's `references.bib` and its citations cross-checked against the build log (see the gate).

### Milestone 9: Bib Manager, enrichment, and bibliography refactoring

Implement the Bib Manager custom editor, the entry form editor, search, formatting and sorting, key templates, project wide key rename, duplicate merge, clean unused, normalizers, dialect conversion, import and export formats, enrichment from identifiers with caching and diffs, and the Zotero bridge.

Deliverable: a complete bibliography workflow, meeting PERF-17.

### Milestone 10: Editing productivity (desktop-editor class)

Implement snippets, environment insertion, selection wrapping, list behavior, outline and structure editing, folding, word count, the symbol palette, math assistance, live math preview, wizards (quick start, table, graphics, other), user macros, project wide search and safe refactoring, bookmarks and TODOs, and spell and grammar checking.

Deliverable: productive source editing without disruptive editor behavior, meeting PERF-16 and PERF-18.

### Milestone 11: Fast builds

Implement the fast preview mode (preamble precompilation and draft assets), partial builds, the status bar toggles, and the speedup benchmarks, with automatic fallback to the normal build.

Deliverable: measured speedups on the Thesis corpus or an honest report that the target was not met for a given engine.

### Milestone 12: Online-editor workflow

Implement image paste and drop, templates gallery, local snapshots and labelled versions, comments and tracked changes, latexdiff integration, submission and archive export with verification, the source ZIP, watermarked PDF export, the online template library, project dashboard, ZIP import and export, and Git interoperability with online LaTeX services.

Deliverable: a self-contained, offline-capable project workflow with review and history.

### Milestone 13: Visual editor

Implement the visual editing mode with opaque islands and minimal edits.

Deliverable: byte identical round trip of unedited documents on the corpus, and responsive editing on a 200 page thesis.

### Milestone 14: Collaboration (Tier 2, feature flagged)

Implement the Live Share compatibility checks, the CRDT based collaboration client, the self-hostable relay server, presence, and security measures. This milestone may be scheduled after the first release; if so, the feature flag stays off and the documentation says it is not included.

Deliverable: converging collaborative editing in simulated multi client tests, or an explicit documented deferral.

### Milestone 15: User experience

Finish the sidebar, project dashboard, context menus, status bar, keybindings (including the optional desktop-editor keymap preset), setup experience, settings presets, and settings validation.

Deliverable: a coherent, polished VS Code experience.

### Milestone 16: Hardening

Run unit tests, integration tests, end to end tests where available, the full benchmark suite against the reference environment, security tests, packaging checks, and platform compatibility checks. Fix defects and document any remaining limitations.

Deliverable: a release candidate with reproducible build and test instructions and the final reports required by the final reporting section. **The release candidate must pass the Dissertation final validation gate** (Gate B, because the figure files are present; Gate A only on a machine where they are absent, with the limitation stated in the report).

## 30. Acceptance criteria

The extension must not be considered complete until the following core scenarios work:

1. Open a directory containing a multi file LaTeX manuscript.
2. Identify the correct root document.
3. Resolve included source files and bibliography files.
4. Compile the document using a real installed TeX toolchain.
5. Display compiler errors and warnings in VS Code.
6. Automatically rebuild when relevant source changes are saved, if enabled.
7. Open the generated PDF inside VS Code.
8. Refresh the viewer after a successful rebuild.
9. Navigate from source to PDF and back using SyncTeX.
10. Complete citation keys from real `.bib` files.
11. Complete labels and references from actual project source.
12. Insert environments and wrap selected text.
13. Navigate the document through a hierarchical outline.
14. Format source through an installed formatter.
15. Search citations and inspect their metadata.
16. Stop a running compilation without leaving orphaned processes.
17. Clean generated files without deleting source material.
18. Handle missing executables and malformed documents gracefully.
19. Work without network access for ordinary editing and compilation.
20. Produce an installable VSIX with documented prerequisites.

Additional acceptance criteria for performance, bibliography, desktop-editor, and online-editor features:

21. All PERF budgets are measured on the reference environment and met, or each exception is documented with its measured value and reason.
22. Activation time is under 50 ms (PERF-1), and typing in a 20,000 line file adds under 4 ms per keystroke (PERF-2).
23. A fast preview rebuild of the Thesis corpus after a small edit meets the documented speedup target or is honestly reported as not met for the engine.
24. The PDF refreshes after a rebuild without flicker and without losing the reading position.
25. Forward and reverse SyncTeX complete in under 50 ms warm and agree with the `synctex` tool on the fixtures.
26. Open a 10,000 entry `.bib` file in the Bib Manager, filter and sort it within budget, and edit a field in the form editor with the text updating minimally and undo working.
27. The completeness scanner reports every seeded problem in the bibliography fixtures with the correct code and location, reports no false positives on the clean fixture, and the CLI output matches the extension output.
28. Rename a citation key across a multi-file project with a preview, and merge two duplicate entries while rewriting citations.
29. Complete an entry from a DOI using a recorded response, showing a field-by-field diff and writing only accepted fields, with source attribution.
30. Round trip identity holds: formatting off, an unedited `.bib` file and an unedited `.tex` file opened and saved through the Bib Manager and the visual editor are byte identical.
31. The symbol palette, table wizard (including parsing an existing table back), and quick start wizard produce correct source that compiles.
32. Spell checking ignores commands, math, labels, and citations, switches language with `babel` commands, and offers dictionary actions.
33. Project-wide rename of a label and of a command works with a preview and no collateral edits.
34. Paste an image into a document, producing a unique file and a compiling figure environment.
35. Comments and tracked changes survive edits and reload; a latexdiff document can be generated against a snapshot.
36. Snapshots can be restored safely, with a pre-restore snapshot created.
37. Export for submission produces a minimal archive that compiles in a clean directory.
38. With network features disabled, no network request is made by any feature (verified by test), and with them enabled, only the inventory's endpoints are contacted.
39. If the collaboration module is delivered, two clients converge after concurrent edits and reconnects; if it is not delivered in the release, it is documented as not included.
40. The extension passes the security tests for archive extraction, macro trust, and message validation.
41. A package loaded twice is underlined in red and the quick fix removes the repeated load.
42. Create Source ZIP on the Thesis corpus produces an archive without the compiled PDF or build output that compiles in a clean directory.
43. Export PDF with Watermark produces a copy with the watermark on every page and leaves the built PDF unchanged.
44. Create from Template downloads a template from the catalog, creates a project that builds, and works offline from the cached catalog; searching a 10,000 template catalog stays within OL-53's budget.
45. The Dissertation final validation gate below passes.

### Final validation gate: build the Dissertation to `main.pdf`

**Purpose.** The final test of the tool's validity is that it can take the author's real thesis in `thesis/` and, with no manual intervention and no edits to the source, compile it into a valid `main.pdf`. Every other feature may pass its own tests, but the product is not accepted until this gate passes (or is honestly reported as limited, as described under Gate A and Gate B).

**Pre-flight (automated, at the start of the gate).** Verify and record: the fixture path exists; `main.tex` exists and is the detected root; the include graph is resolved with no unresolved includes; `PhDThesisPSnPDF.cls` and `references.bib` are found; the installed TeX toolchain and versions (engine, `bibtex`, `makeindex`, `latexmk` if present); every package required by the class and preamble is available (using the package availability check, TS-32), and if any is missing the gate stops with the list of missing packages and the suggested install command, rather than producing a misleading failure; the number of active `\includegraphics` references (ignoring commented-out ones) and, for each, whether the file resolves through the thesis's graphics path and which file (and extension) the engine will pick. Compute and store SHA-256 hashes of all source files, class file, and bibliography before the build.

**Safety rules.**
1. Automated runs build in a temporary copy of the folder, never in place. The copy is deleted afterward unless the user asks to keep it.
2. A manual in-place run (the author building their thesis normally) is allowed, but before the first in-place build the tool must create a recoverable snapshot (OL-23) of the existing `main.pdf` and `main.synctex.gz`, state in the build log that it did so, and never delete them.
3. The gate never modifies any `.tex`, `.bib`, `.cls`, `.sty` file. After the build, the hashes of all source files must be identical to the pre-flight values; any difference fails the gate.
4. The thesis content is never sent to any network service other than the author's own private source repository, never included in the packaged extension, the public resources repository or a CI artifact, and the gate report contains counts, hashes, timings, and diagnostics locations only, not manuscript text.

**Required outcome in the primary configuration.** With the default settings, root `main.tex`, no output directory override, and the default recipe, a build from a clean state (no auxiliary files) produces the file `main.pdf` in the same directory as `main.tex` (job name `main`), together with `main.synctex.gz`, `main.bbl`, `main.ind`, and the usual auxiliary files. A second configuration sets a separate output directory (for example `build/`) and must produce `build/main.pdf` with working SyncTeX and viewer.

**Gate A: structural build (runs only when figure files are absent, for example on a machine or clone without `Figs/`; it is no longer the state of the supplied folder).** When figures are missing, a build that includes graphics cannot succeed as a full build; the tool must handle this as follows:
1. Pre-flight must report the exact number of unresolved graphics (references and unique names), grouped by the chapter file in which they occur, before compiling, and show them in the Problems view as warnings with correct source locations.
2. The tool must offer, and the gate must use, the draft graphics mode (PERF-B3) so the document compiles with placeholders for missing images. The resulting PDF must be clearly marked as a draft or placeholder build in the tool's UI and report.
3. The build must complete and produce a valid `main.pdf` with zero TeX errors, with every pass and tool (`pdflatex`, `bibtex`, `makeindex`) run in the right order and the right number of times, and no remaining "Rerun to get cross-references right" message.
4. The only remaining warnings attributable to missing figures are those the tool classified as missing-graphics; any other warning or error is reported as a failure of the gate or as a documented thesis issue, never hidden.
5. The page count is recorded but not compared with the legacy 254 pages, because placeholders change float sizes and pagination.

**Gate B: full build (the primary gate; the figure files are now present in the supplied folder).** All Gate A conditions apply except draft mode and the missing-graphics report, plus:
1. Zero TeX errors, and zero "Citation ... undefined", "Reference ... undefined", "There were undefined references", and "Label(s) may have changed" messages in the final log.
2. All graphics resolve; the missing-graphics count is zero. The pre-flight count must be exactly the number of active (uncommented) `\includegraphics` references, and the two commented-out references in `document-info.tex` must not appear as missing.
3. The page count is within a documented tolerance of the legacy 254 pages. Because the legacy output came from a different distribution (MiKTeX with pdfTeX 1.40.24) and the tolerance cannot be known in advance, the first full run must record the actual page count and a human review of the differences, then fix the tolerance in the test; do not choose a tolerance to make the test pass without that review.
4. Structural checks on the PDF using standard tools (for example `pdfinfo`, `pdffonts`, `pdftotext`): the file is a valid PDF with a correct trailer; A4 page size; all fonts embedded; a non-empty outline (bookmarks) with chapters; the table of contents, list of tables, list of figures, and list of algorithms are non-empty; the bibliography is present and its numbered reference count equals the number of distinct keys cited in the source (computed independently from the index); the index is present; and the extracted text contains no `??` placeholders.
5. Visual regression, advisory not mandatory: render a sample of pages (title page, a chapter opening, a page with a figure, a page with a table, the bibliography, the index) and compare them with the legacy `main.pdf` using a perceptual comparison, producing a side by side report for human review. Differences from distribution and font versions are expected and are not automatic failures.

**Behaviors that must be demonstrated on the thesis (both gates).**
1. *Root and dependencies.* Root detection picks `main.tex` silently; the dependency graph lists every included chapter, the class file, the bibliography, and the resolved and unresolved graphics; commented out includes are ignored.
2. *Build correctness and minimal passes.* The smart pass engine reaches a stable result in the fewest passes (record the count), runs `bibtex` only because citations exist, and runs `makeindex` only because an index exists; a second build with no source change performs no unnecessary passes and finishes in a fraction of the first build time (record both).
3. *Incremental and fast builds.* After a one-sentence edit in `chapter-intro.tex` (made in a temporary copy), the incremental rebuild and the fast preview rebuild are timed and compared with the full build, and the PDF viewer refreshes without losing position (PERF-13, PERF-B2).
4. *Diagnostics.* The count and locations of diagnostics in the Problems view equal those derived independently from the log; every diagnostic points to an existing file and line, including inside the CRLF files; the friendly explanation appears for each recognized error class.
5. *SyncTeX.* Forward sync from at least ten sampled source lines spread across at least five different files (including a CRLF file and a very long line), and reverse sync from at least ten sampled PDF positions, all agree with the real `synctex` tool within the documented tolerance and complete within PERF-15.
6. *Bibliography editor.* Run the completeness scanner on `references.bib` with the "Standard" and "Strict submission" profiles; record the findings as a baseline report for the author (the findings are discovered, not predetermined, and must not be invented). Cross-check: the set of citation keys reported as unresolved by the scanner equals the set reported as undefined by the compiler log, and the set of uncited entries is consistent with the bibliography actually printed. Opening and saving the file through the Bib Manager without edits leaves it byte identical.
7. *Round trip identity.* Opening and saving `main.tex` and each chapter through the visual editor without edits, and through the formatter in check-only mode, leaves every file byte identical, including line endings.
8. *Editing intelligence on real content.* Completion of a `\ref` to a label defined in another chapter, completion of a citation key, go to definition across chapters, rename preview of a label (not applied), and the structure view showing the chapter and section hierarchy with correct counts; the spell checker runs over the whole thesis within PERF-16 without crashing and without flagging commands, math, labels, or citation keys.
9. *Performance.* The thesis is the Thesis benchmark corpus. Record cold index time, warm start time, completion latency, outline refresh, memory, and event loop delay against the PERF budgets.
10. *Cancellation and cleanup.* Stop a build in the middle of the thesis compile and verify no orphaned processes; clean auxiliary files in the temporary copy and verify that only generated files were removed and that the source files, class file, bibliography, and any figures are intact.
11. *Cross platform.* The gate must pass on macOS on Apple Silicon (the author's platform) with a standard TeX Live or MacTeX installation. It should also pass on Linux, and on Windows where the fixture and a TeX distribution are available.
12. *Robustness.* Re-run with a deliberately broken copy (one chapter with an injected undefined command and an injected missing brace, one citation key renamed) and verify the tool reports the errors at the correct places, still produces the best available PDF when the engine does, and that restoring the copy returns to a clean build.

**Evidence.** The gate command (for example `npm run gate:dissertation`) must produce a report, `dissertation-gate-report.json` and a human readable `.md`, written outside the `thesis/` folder (in `reports/`), containing the tool and TeX versions, platform, pre-flight results, each tool invocation with its command line and exit code, pass counts, timings, the missing graphics list (names and counts), diagnostics summary, PDF facts (path, size, SHA-256, page count, fonts, outline entries), the SyncTeX comparison table, the bibliography scanner summary, the PERF measurements, the hash comparison of source files before and after, and an overall verdict of PASS, PASS (Gate A only, figures absent), or FAIL with reasons. A skipped gate must say SKIPPED with the reason (for example the fixture is not present on this machine) and must never be reported as passing.

**Failure policy.** If the thesis does not compile because of a genuine problem in the thesis itself (for example a package it needs is not installed, or a pre-existing error in the source), the gate must say so precisely and attribute it correctly (tool defect versus thesis or environment issue) with evidence, and must not be "fixed" by silently editing the thesis or loosening the test. If the plain command line sequence from the thesis's own `compile-thesis.sh` succeeds and the tool does not, that is a tool defect.

Each criterion must have a corresponding automated test where technically possible, or a documented manual verification procedure where automation is impractical.

## 31. Mandatory development rules

- Do not implement everything in one enormous file.
- Do not stop at scaffolding or a written plan.
- Do not generate fake implementations that only imitate the expected interface.
- Do not claim that SyncTeX works without testing real source to PDF mappings.
- Do not claim that PDF viewing works without rendering an actual PDF.
- Do not claim that compilation works without invoking a real or controlled compiler process.
- Do not hardcode a particular user's executable paths.
- Do not make platform specific assumptions in shared logic.
- Do not introduce unnecessary frameworks or dependencies.
- Do not silently swallow exceptions.
- Do not commit generated files or build artifacts unless intentionally required.
- Do not overwrite user project files.
- Do not use arbitrary shell execution where a direct executable invocation is appropriate.
- Do not leave dead commands, empty event handlers, or placeholder TODO implementations for required features.
- Do not report tests as passing unless they were actually executed.
- When an external dependency is unavailable, implement the integration, provide a testable abstraction, and document the missing runtime dependency honestly.
- Keep the README synchronized with the implemented behavior.

- Do not claim that the extension is fast without measurements from the benchmark suite on the reference environment.
- Do not block the extension host event loop for heavy work; use the worker pool.
- Do not make a network request from any feature that is not listed in the network inventory, and never before the user has opted in.
- Do not rewrite unchanged bibliography or source text; all automated edits must be minimal, previewed when large, and undoable.
- Do not auto-fix anything that requires judgment (merging works, choosing between conflicting values, deleting entries).
- Do not fabricate or guess bibliographic data. Every enriched value must come from a cited source response or from the user.
- Do not copy code, icons, dictionaries, completion databases, help text, or symbol databases from other products unless their license permits redistribution and the provenance is recorded.
- Do not execute commands or scripts embedded in LaTeX, BibTeX, review, template, or project files.
- Do not interoperate with undocumented web endpoints of third party services.
- Do not mark a requirement identifier complete without a test or a documented manual procedure that references that identifier.
- Do not claim the product is complete or valid until the Dissertation final validation gate has been run and its report produced; do not report the gate as passed when it was skipped or when only Gate A was possible.
- Do not modify, reformat, rename, or delete any file in the author's `thesis/` folder, and do not overwrite its existing `main.pdf` without a recoverable snapshot.
- Do not copy the thesis content into the packaged extension, the public resources repository, test snapshots, logs shared outside the machine, or CI artifacts. It lives only in `thesis/` of the private source repository.
- Do not create git commits in the author's repositories. Leave changes uncommitted; the author reviews and commits them.

## 32. Final reporting

At the end of each milestone, report:

1. Features implemented.
2. Files and modules created or changed.
3. Tests executed and their actual results.
4. Commands used to build and test the extension.
5. External dependencies required.
6. Known defects and limitations.
7. The next milestone and its prerequisites.
8. Gate status: the latest result of the Dissertation gate (PASS, PASS Gate A only, FAIL, or SKIPPED with reason) and the path to its report.
9. Performance: the benchmark results for the budgets relevant to the milestone, with hardware details, compared with the budget and with the previous milestone.
10. Requirement coverage: the list of requirement identifiers (PERF, BIB, TS, OL) completed in the milestone, each with its test or manual procedure.

At final delivery, additionally provide: the Dissertation gate report and the produced `main.pdf` facts, the full benchmark table, the bibliography scanner results on the fixtures, the feature parity matrix showing the status of each [LW], [TS], [OL], and [BIB] feature (complete, partial with limitations, or deferred, never silently omitted), the network inventory, and the list of known limitations. Provide the extension source code, a reproducible development setup, an installable VSIX if packaging tools are available, a complete README, and a concise acceptance test report.

Begin by inspecting the repository and identifying the most appropriate implementation plan. Then proceed with Milestone 1 and continue through the milestones without waiting for approval after every routine step. Ask questions only when a genuinely blocking decision cannot be resolved from the repository or established requirements.
