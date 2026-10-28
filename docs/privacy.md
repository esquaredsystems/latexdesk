# Privacy and network use

LaTeX Desk has no telemetry and does not look up metadata online. Its only network feature is the
template library behind **Create from Template**, and it is used only when you open the template
gallery or create a project from it. Everything else works offline.

| Feature | Network | Notes |
|---|---|---|
| Build, diagnostics, PDF viewer, SyncTeX | none | Runs your local TeX tools |
| Completion, hovers, checks, spelling | none | Bundled data and dictionaries |
| Bibliography checker and Bib Manager | none | |
| History, export, table wizard, watermark | none | Files stay on your computer |
| Create from Template | `raw.githubusercontent.com` (repository `esquaredsystems/latexdesk-resources`), or the address in `latexdesk.templates.catalogUrl` | Downloads `templates.json` when the gallery opens (at most once an hour, or on Refresh) and a template's ZIP when you create a project. Nothing is sent beyond the request itself. The last catalog is kept for offline use. |

To turn every download off, set `latexdesk.network.enabled` to `false`. The template gallery then
shows only its cached catalog, a blank project, and "From a ZIP file on disk".

What it runs on your computer: the TeX tools of your distribution (latexmk, pdflatex, bibtex,
makeindex, latexdiff, latexindent, texcount, kpsewhich) with argument lists, never through a
shell, and only in trusted workspaces. Commands written inside your documents are never executed
by the extension (your TeX engine decides about `\write18`; shell escape is not enabled by the
default recipes).

What it writes: see "Files LaTeX Desk writes" in the README.

Features that would need the network in a future version (DOI/arXiv lookup, Zotero web API) will
be off until you turn them on, and will be listed here with the hosts they contact.
