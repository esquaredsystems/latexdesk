# Performance

Numbers below were measured with `npm run gate:dissertation` on the author's thesis (254 pages,
17 source files, 355 figures, 231 bibliography entries) on a 4-core arm64 Linux VM with TeX Live
2022 and latexmk 4.76. They are wall-clock times from a single run, not percentiles; the TeX
engine's own time is part of every build number.

## Builds

| Build | Time | Notes |
|---|---|---|
| Full build from a clean folder | 47–59 s | latexmk: pdflatex ×4, makeindex, bibtex ×3 |
| Second build, nothing changed | 0.1 s | latexmk runs no rule |
| Incremental build after a one-sentence edit | 12–14 s | one pdflatex pass |
| Partial build of `chapter-intro` (42 pages) | 1.8–2.1 s | **about 7× faster** than the incremental build |
| Fast preview, first run in its folder | 24–27 s | latexmk has no history there yet, so it also runs BibTeX and makeindex once |
| Fast preview, later edits | 12.0 s | the same as an incremental build |

**Fast preview does not reach the 2× target on this thesis.** Its only saving is not embedding
images (draft mode), and pdfTeX embeds PNG files cheaply, so there is nothing to win. It is
therefore off by default; it may help documents with many large PDF or EPS figures or heavy
TikZ. Partial builds are the fast option for chapter-by-chapter work.

Before this was measured, the preview folder was re-seeded from the full build every time,
which made latexmk redo all passes (17 s instead of 12 s). It is now seeded only once.

## Editor features

| Operation | Measured | Budget in the specification |
|---|---|---|
| SyncTeX forward search (in-process, warm) | 0.1–1.3 ms | 50 ms (PERF-15) |
| SyncTeX reverse search | 0.3–7 ms | 50 ms (PERF-15) |
| Spell check of the whole thesis, first pass including dictionary load | 120–170 ms | 1 s (PERF-16) |
| Spell check, slowest single file | 10–12 ms | |
| Unchanged second build | 0.1 s | |

## Not measured yet

The specification's benchmark suite (`npm run bench`, synthetic 1,000-page and 10,000-entry
corpora, p95 over 30 runs, CI regression gates) is not implemented. Activation time, keystroke
overhead (PERF-1/2) and completion latency on large projects have not been measured. Parsing
runs on the extension host thread and re-parses a whole file after an edit (debounced); the
specification's incremental lexer and worker pool (PERF-3, mandatory technique 2) are planned.
Spell checking already runs in a worker.
