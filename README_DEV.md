# LaTeX Desk: developer guide

This guide is for people working on the extension itself. If you just want to use LaTeX Desk, see
the [README](README.md).

## Prerequisites

- Node.js 20 or newer and npm.
- VS Code 1.85 or newer.
- A TeX distribution with `latexmk`, `pdflatex` and `synctex` (TeX Live, MacTeX or MiKTeX). The
  build and SyncTeX tests are skipped when these are missing; everything else runs without TeX.

## Set up and run

```sh
git clone https://github.com/esquaredsystems/latexdesk.git
cd latexdesk
npm ci
npm run build
```

Open the folder in VS Code and press **F5** (choose **VS Code Extension Development** if asked).
This starts an Extension Development Host with LaTeX Desk loaded. Run `npm run watch` alongside it to
rebuild on every change, then reload the host window (**Developer: Reload Window**) to pick the
change up.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Bundles the extension, CLI and webviews into `dist/` with esbuild |
| `npm run watch` | Same, rebuilding on change |
| `npm test` | Unit tests (vitest); build and SyncTeX tests run when latexmk/pdflatex are installed |
| `npm run lint` | ESLint over `src/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run package` | Production build, then `latexdesk-<version>.vsix` |
| `npm run gate:dissertation` | Builds the thesis in `thesis/` in a temporary copy and writes a report to `reports/` |

Before opening a pull request, run `npm run lint`, `npm run typecheck` and `npm test`.

## How the code is organised

```
src/core/       pure logic, no vscode and no file system: parsers, scanners, transformations
src/build/      Node only (child processes, files): build runner, recipes, history, export
src/extension/  VS Code integration: providers, commands, views, panels
src/webview/    browser code for the panels (PDF viewer, Bib Manager, forms, wizards)
src/cli/        latexdesk-bibcheck and the bundle used by scripts/
data/           JSON tables: commands, symbols, error explanations, BibTeX field rules
media/          CSS for the panels, toolbar icons and the Marketplace icon
test/           vitest suites and fixtures
```

[docs/architecture.md](docs/architecture.md) explains the services, how they depend on each other
and the rules for editing user files. [docs/performance.md](docs/performance.md) has the build and
indexing measurements.

### Conventions

- Keep the code easy to follow for a moderate-level programmer: clear names, small functions,
  comments only where the *why* isn't obvious.
- Prefer popular, well-maintained libraries over the newest ones unless there's a real need.
- `src/core` must not import `vscode` or `fs`, so it stays testable and shared with the CLI.
- Edits to user files are always the smallest replacement of a known range, applied through a
  `WorkspaceEdit`, so Undo works and untouched text stays byte-identical.
- Error explanations live in `data/errors.json`; add an entry there rather than in code.

## The dissertation gate

`thesis/` holds a real 250-page thesis used as an end-to-end test: root detection, a full build,
SyncTeX accuracy, incremental and partial builds, spell checking speed and export for submission.
`npm run gate:dissertation` runs it in a temporary copy (your checkout is never modified) and writes
a pass/fail report to `reports/`. Set `LATEXDESK_GATE_BUDGET_S` to run it in resumable steps on
shells that limit command time.

The thesis is licensed separately under CC BY-NC-ND 4.0 (see [thesis/LICENSE](thesis/LICENSE)). It
is excluded from the packaged extension by `.vscodeignore`.

## README images

The screenshots and GIFs in `images/` show the real extension running a small demo paper (heat
diffusion in composite panels). `README.md` refers to them, and to `docs/`, `LICENSE` and this guide,
with relative paths, so they work when browsing this repository.

This repository is private, so the Marketplace and VS Code can't load files from it. The public
repository [esquaredsystems/latexdesk-resources](https://github.com/esquaredsystems/latexdesk-resources)
holds copies in its `latexdesk/` folder, and `npm run package` passes `--baseImagesUrl` and
`--baseContentUrl` so the packaged README points there. Images are not shipped inside the `.vsix`.

Whenever you add or change an image or a linked document, copy it to the same path under
`latexdesk/` in latexdesk-resources and push that repository **before** publishing.

When the UI changes, retake the affected image at the same size (1440 × 860 window; still images
at 2× pixel density, GIFs at about 1100 px wide and 12 fps) so the README stays consistent.

## Releasing

1. Update `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. `npm run lint && npm run typecheck && npm test`
3. Copy any new or changed README images and linked documents to `latexdesk/` in
   latexdesk-resources and push it.
4. `npm run package` and install the `.vsix` in a clean VS Code profile to smoke-test it
   (**Extensions: Install from VSIX…**).
5. Publish under the `esquaredsystems` publisher:

   ```sh
   npx vsce login esquaredsystems        # once; needs an Azure DevOps token with Marketplace › Manage
   npx vsce publish --packagePath latexdesk-<version>.vsix
   ```

   Alternatively, upload the `.vsix` at
   [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
6. Tag the release: `git tag v<version> && git push --tags`.

## Reporting issues

Use [GitHub issues](https://github.com/esquaredsystems/latexdesk/issues). For build problems, attach
the output of **LaTeX Desk: Check LaTeX Tools** and the relevant part of the build log.
