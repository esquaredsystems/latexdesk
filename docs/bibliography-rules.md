# Bibliography rules

Every finding has a stable code, a default severity and an exact location: the field value, the
field name, or the entry key when something is missing. Severities can be changed per rule with
`latexstudio.bib.rules`, for example `{ "bib/missing-doi": "off", "bib/page-range": "warning" }`,
and a rule can be silenced for one entry with a comment line just above it:

```bibtex
% bib-ignore: missing-doi page-range
@article{smith2019, ...
```

`% bib-ignore: all` silences every rule for that entry. "Fix" means a quick fix is offered;
"safe" means it is also part of **Fix all safe**, which only applies deterministic changes.

| Code | Default | What it checks | Fix |
|---|---|---|---|
| `bib/syntax` | error | The file could not be read here: unbalanced braces, a missing comma, a truncated entry. Parsing continues at the next `@`. | |
| `bib/duplicate-key` | error | Two entries share a key. BibTeX ignores case, so `Smith2019` and `smith2019` collide. | |
| `bib/invalid-key` | error | The key is empty or contains spaces, commas, braces, quotes, `#`, `%`, `=` or a backslash. | |
| `bib/unknown-type` | warning | The entry type does not exist in the active dialect (BibTeX or BibLaTeX). | |
| `bib/missing-required` | warning | A field the entry type requires is absent, e.g. `journal` for `@article`. Alternatives count: `author` or `editor`, `date` for `year` in BibLaTeX. Fields inherited through `crossref`/`xdata` count. | Insert empty fields |
| `bib/missing-recommended` | info | A field the active profile expects (`standard`: e.g. volume, pages; `strict`: also number, address, publisher). | Insert empty fields |
| `bib/missing-doi` | info | No DOI where the profile expects one (articles and proceedings papers). | Insert empty field |
| `bib/duplicate-field` | warning | The same field appears twice in one entry; BibTeX keeps only one. | |
| `bib/unknown-field` | hint | A field name that neither dialect knows, with a "did you mean" suggestion when one is close. | Rename to the suggestion |
| `bib/empty-field` | warning | A field with an empty value. | |
| `bib/placeholder-value` | warning | Values such as `TODO`, `TBD`, `???`, `xxx`, `unknown`, `n/a`. | |
| `bib/unbalanced-braces` | error | A value whose `{` and `}` do not match. | |
| `bib/et-al` | warning | `et al.` written inside an author or editor list. BibTeX styles need `and others`. | Safe |
| `bib/author-format` | warning | An empty name in a name list, such as a trailing `and`. | |
| `bib/invalid-year` | warning | A year that is not four digits, before 1400, or more than a year in the future. | |
| `bib/invalid-month` | warning | A month that is neither a number 1–12, a month macro (`jan`), nor a month name. | |
| `bib/page-range` | info | A page range written with a single hyphen (`12-18`). BibTeX uses an en dash, `12--18`. | Safe |
| `bib/invalid-doi` | warning | A DOI that does not look like `10.xxxx/...`. | |
| `bib/doi-url` | hint | A DOI stored as a URL (`https://doi.org/10...`). Styles add the prefix themselves. | Safe |
| `bib/invalid-url` | warning | A `url` that is not an `http(s)://` or `ftp://` address (two URLs in one field are reported here). | |
| `bib/invalid-isbn` | warning | An ISBN with the wrong length or check digit. | |
| `bib/unescaped-char` | warning | `&`, `%`, `#` or `_` in a text field outside math, which LaTeX treats as special. | Escape the character |
| `bib/undefined-string` | error | A bare word used as a value (an `@string` macro) that is not defined and is not a month macro. | |
| `bib/missing-crossref` | warning | `crossref` points to a key that is not in the file. | |
| `bib/duplicate-work` | warning | Two entries describe the same work: same DOI, arXiv id or ISBN, or (marked "possible") the same normalised title, first author and year. Nothing is merged automatically. | |
| `bib/uncited` | hint | The entry is never cited in the project. Set `latexstudio.bib.uncited` to `off` or `warning`. | |

## Profiles

`latexstudio.bib.profile` decides which recommended fields are expected. The tables are in
`data/bibFields.json`, so they can be read and reviewed in one place.

| Profile | Adds |
|---|---|
| `minimal` | Nothing beyond the required fields |
| `standard` | DOI, volume and pages for articles; pages and DOI for proceedings papers; ISBN for books; `urldate` for online sources |
| `strict` | Also issue numbers, publishers for proceedings, addresses for books and theses, and a URL or DOI for `@misc` |

## Score

Each entry gets a score from 0 to 100:

    70 × share of required fields present
  + 20 × share of recommended fields present (standard profile when the profile is minimal)
  + 10 × max(0, 1 − 0.25 × value problems)

"Value problems" are all findings except the missing-field and uncited rules. The Bib Manager shows
the score per entry and the average per file.

## Command line

`latexstudio-bibcheck` uses the same code:

```
latexstudio-bibcheck <file.bib...> [--profile minimal|standard|strict] [--dialect bibtex|biblatex]
                     [--tex main.tex] [--format text|json|sarif] [--fail-on error|warning|none]
```

With `--tex`, citations of the document are read so `bib/uncited` and unresolved citations are
reported too. The exit code is 1 when a finding at or above `--fail-on` exists.
