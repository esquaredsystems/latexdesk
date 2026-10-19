# Influence Mining in Complex Networks

PhD thesis by **Owais A. Hussain**, Graduate School of Science and Engineering, Karachi Institute of
Economics and Technology (KIET), December 2022.
Supervisor: Prof. Dr. Maaz Bin Ahmad. Advisor: Dr. Faraz A. Zaidi.

The compiled PDF is attached to the
[releases of this repository](https://github.com/esquaredsystems/latexdesk/releases).

## About

In a connected network, a few influential nodes (people, places, events) can start a ripple effect
across the whole network. Finding a small seed set that maximises this influence is NP-complete,
and no single method is both accurate and scalable on every kind of network. The thesis proves the
hardness of the problem and then studies it through three experiments: whether network structure or
the selection method decides how well a seed set performs; how well influence mining finds known
vital nodes in real networks; and how machine learning models can identify influential nodes. From
these findings it proposes **IMine**, an influence mining framework with custom stopping criteria
and a pluggable influence quantifier for benchmarking, evaluated on a large and diverse set of
networks.

## Contents

| File | Chapter |
|---|---|
| `chapter-intro.tex` | 1. Introduction |
| `chapter-domain.tex` | 2. Domain, Background and Problem Definition |
| `chapter-related.tex` | 3. Related work |
| `chapter-proof.tex` | 4. Mathematical Proof |
| `chapter-experiment.tex` | 5. Study design and experiments |
| `chapter-framework.tex` | 6. The Influence Mining Framework |
| `chapter-conclusion.tex` | 7. Conclusion and Future Work |
| `glossary.tex`, `appendix-B.tex`, `appendix-C.tex`, `appendix-C2.tex` | Glossary, tables and figures |

`main.tex` is the root document. Front matter is in `abstract.tex`, `declaration.tex`,
`acknowledgement.tex` and `document-info.tex`; the bibliography is `references.bib` and the figures
are in `Figs/`.

## Building

With the LaTeX Desk extension, open this folder in VS Code, open `main.tex` and press
**Ctrl+Alt+B** (**Cmd+Alt+B** on macOS).

From a terminal, with TeX Live, MacTeX or MiKTeX installed:

```sh
latexmk -pdf main.tex
```

`compile-thesis.sh` (and `compile-thesis-windows.bat`) run the same steps one by one: pdflatex,
bibtex, makeindex and two more pdflatex passes. The build needs the `algorithm2e`, `algorithms`,
`algorithmicx` and `siunitx` packages, which full TeX distributions include.

This thesis is also the real-world test for LaTeX Desk: `npm run gate:dissertation` in the
repository root builds it in a temporary copy and checks the result.

## Citing

```bibtex
@phdthesis{hussain2022influence,
  author = {Hussain, Owais A.},
  title  = {Influence Mining in Complex Networks},
  school = {Karachi Institute of Economics and Technology},
  year   = {2022},
  month  = dec,
}
```

## Licence

The text of the thesis and the figures created by the author are licensed under
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/): you may share them with
credit, but not commercially and not in modified form. See [LICENSE](LICENSE).

Some files are not the author's own and keep their own terms:

| File | Source and licence |
|---|---|
| `PhDThesisPSnPDF.cls` | Thesis class from the CUED PhD thesis template by Krishna Kumar, MIT licence (notice in the file) |
| `compile-thesis.sh`, `compile-thesis-windows.bat` | From the same template |
| `breakurl.sty` | Vilar Camara Neto, LaTeX Project Public License 1.2 or later |
| `glyphtounicode.tex` | Glyph-to-Unicode map distributed with pdfTeX |
| `Figs/kiet.jpg`, `Figs/pafkiet.png` | Logos of their institutions; not covered by this licence |
| Figures credited to other sources in their captions | Remain under their owners' terms |
