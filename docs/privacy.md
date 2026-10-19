# Privacy and network use

LaTeX Desk makes **no network requests**. It has no telemetry, does not look up metadata
online, and does not download dictionaries or templates. Everything it needs is in the extension.

| Feature | Network | Notes |
|---|---|---|
| Build, diagnostics, PDF viewer, SyncTeX | none | Runs your local TeX tools |
| Completion, hovers, checks, spelling | none | Bundled data and dictionaries |
| Bibliography checker and Bib Manager | none | |
| History, export, table wizard | none | Files stay on your computer |

What it runs on your computer: the TeX tools of your distribution (latexmk, pdflatex, bibtex,
makeindex, latexdiff, latexindent, texcount, kpsewhich) with argument lists, never through a
shell, and only in trusted workspaces. Commands written inside your documents are never executed
by the extension (your TeX engine decides about `\write18`; shell escape is not enabled by the
default recipes).

What it writes: see "Files LaTeX Desk writes" in the README.

Features that would need the network in a future version (DOI/arXiv lookup, Zotero web API) will
be off until you turn them on, and will be listed here with the hosts they contact.
