---
title: Improve pipeline
---

# Improve pipeline

The **jupytext** ruleset runs 19 steps in order. Steps in `steps/common/` are shared; `steps/jupytext/` handle notebook regions and cell tags.

```bash
jdh-cli article.md --list-steps
```

## Step sequence

| #   | Step                                       | Emits directives / side effects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prepare workdir                            | Wipe workdir; copy input, assets, deploy `plugins/*.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | Init myst.yml                              | The repo's `myst.yml` as the base (hand edits kept), else a scaffold; register all bundled plugins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | Number cells                               | A `#jdh-cell(n)` marker before each markdown cell: paragraph numbers as on the JDH website (see [Paragraph numbers](#paragraph-numbers))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | Citations (Zotero, cite2c and author .bib) | `references.bib` from notebook citation metadata — `citation-manager` items and cite2c's `metadata.cite2c.citations` alike; registers the repo's `.bib` files (author entries replace duplicates); rewrite `<cite>` → MyST citations, unresolved ones → plain text. Citations the author grouped in one pair of parentheses are merged into one, so APA prints a single pair; a page locator becomes a citation supplement, `[@key, pp. 50-52]`, with or without the author's comma. A pair of parentheses holding only citations, locators and short connectives is lifted whole into one citation, so `(e.g. <cite/>, <cite/>)` prints `(e.g. Crane, 2018; Mold et al., 2019)` |
| 5   | Improve citation tags                      | Author–year citekeys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | Extract jupytext frontmatter               | Every `contributor` cell → `myst.yml` authors (name, ORCID, email, affiliations); title and keywords (a `Keywords:` label, `;` and `,` all handled); the regions are removed from the article                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7   | Enrich affiliations (ROR)                  | ROR-backed affiliation objects in `myst.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | Extract jupytext parts                     | Page-level frontmatter from document parts (abstract, copyright)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9   | Drop hidden cells                          | Cells tagged `hidden` are removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 10  | Improve anchors                            | `anchor-*` tags → MyST targets, so `[text](#anchor-…)` links resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | Improve notebook figures                   | `{figure}` only (no `{code-block}` for figure cells); reads `article.ipynb` for captions and reports figures it can't convert yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 12  | Improve notebook tables                    | `:::{jdh-table}` from the notebook output of table-tagged code cells (pandas, HTML or markdown tables); the code is dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Improve Jupytext tables                    | ` ```{jdh-table} ` for every table region (numbered or descriptive tags); `Table N` and `anchor-*` references → label links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 14  | Improve dialogue regions                   | ` ```{jdh-dialogue} ` for `dialog-*` regions (speech bubbles, "Dialogue N")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 15  | Improve hermeneutics blocks                | `:::{hermeneutics}` for tagged regions/cells                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 16  | Image outputs of untagged code cells       | An untagged code cell's image output is placed after its code. A cell tagged `cover` shows its image (the file named in `Image(…)`, else the stored output) in place of the code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 17  | Set project.github                         | `project.github` from git remote                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 18  | Set article metadata                       | From the JDH API record: `project.doi`, `project.date` (publication date), `project.license` (`copyright_type`), `project.venue.title` (issue); `project.social.url` = JDH article page; export options `article_url` and `forthcoming` for the PDF sidebar (see [CLI](cli.md#doi-and-url))                                                                                                                                                                                                                                                                                                                                                                                      |
| 19  | Generate QR code and fingerprint           | `generated/qr.png` from the article URL and `generated/fingerprint.png` from `article.ipynb`, for each one not given with `--qr-code` / `--fingerprint` or present in the repo's `generated/` (see [CLI](cli.md#qr-code-and-fingerprint))                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Steps 11–16 are the **transform steps** that emit custom directives. See the plugin pages for syntax and options.

## Paragraph numbers

The PDF numbers paragraphs as the JDH website does (JDH-042), so "¶40" refers to the same text in print and online.

- **One number per notebook cell, in notebook order.** Code cells, figures, tables and hidden cells take a number too. Only metadata cells are skipped: those tagged `title`, `abstract`, `contributor`, `collaborators`, `keywords` or `disclaimer`. The rule is ported from the website's `src/logic/ipynb.jsx` (C2DH/journal-of-digital-history).
- **Only markdown cells show their number**, on the cell's first block (paragraph, heading, quote or list). A cell with several paragraphs shows one number. Code, figure and hidden cells show none, so the numbers have **gaps**, as online. The copyright cell takes a number online but moves to the front matter, so the first number in the body can be 2 or 3.
- **How:** step 3 reads `article.ipynb`, numbers the cells, and puts a raw Typst marker before each shown markdown cell in `article.md` (before its `<!-- #region … -->` line, if it has one):

  ````markdown
  ```{raw:typst}
  #jdh-cell(7)
  ```
  ````

  Cells are found by the first 40 characters of their first line, searching forward, so later rewrites of the rest of the line (e.g. citations) don't matter. Cells it can't find are reported and get no number. The template's `jdh-cell(n)` shows `n` on the next block. Without any markers (no `article.ipynb`), the template numbers paragraphs in order, as before.

- Dialogue cells get no marker: they become "Dialogue N" figures.

## Citations

Two notebook formats, read by step 4 into one `references.bib`:

|                    | Metadata                                    | In the prose                                                                                                                                                            |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `citation-manager` | `metadata['citation-manager'].items.zotero` | `<cite id="c1"><a href="#zotero%7C…">(Rosenzweig, 2003)</a></cite>` — the id needs the markdown-comment mapping, and the element carries printable text to fall back on |
| **cite2c**         | `metadata.cite2c.citations`                 | `<cite data-cite="1787664/QEP4R77C"></cite>` — the item id _is_ the attribute, and there is no fallback text                                                            |

Both hold CSL-JSON, except that cite2c writes dates as `{year, month, day}` rather than
`{"date-parts": [[y, m, d]]}`; they are converted on the way in. Without that every entry
silently loses its year. No article uses both formats.

A `.bib` in the article repo wins over a notebook item describing the same work (same DOI,
else same title and year), and is registered beside the generated file — a repo's own
`references.bib` is copied in as `references.author.bib` so the names don't collide. A
cite2c marker whose id is in no bibliography is left in place rather than dropped, so an
empty `()` cannot hide it.

Step 5 then renames every citekey to author–year (`Allen2020`, `BambraSmith2010`,
`BrownEtAl2020`), the same for both formats.

### One pair of parentheses

Authors write their own brackets around a citation, which would otherwise print as
`((Author, 2023))`. A pair holding **nothing but** citations, locators and short
connectives is lifted whole into a single MyST citation:

| The author wrote                    | Becomes          | Prints                                           |
| ----------------------------------- | ---------------- | ------------------------------------------------ |
| `(<cite/>)`                         | `[@key]`         | `(Milligan, 2019)`                               |
| `(<cite/> p. 203)` — comma optional | `[@key, p. 203]` | `(Milligan, 2019, p. 203)`                       |
| `(<cite/>, <cite/>)`                | `[@a; @b]`       | `(Crane, 2018; Mold et al., 2019)`               |
| `(e.g. <cite/>, <cite/>)`           | `[e.g. @a; @b]`  | `(e.g. Crane, 2018; Mold et al., 2019)`          |
| `(<cite/>, 1085; <cite/>)`          | `[@a, 1085; @b]` | `(Bialasiewicz & Minca, 2010, 1085; Faro, 2005)` |
| `(as argued <cite/> and later)`     | unchanged        | the author's own parentheses                     |

How it avoids damaging prose:

- The scan **masks every `<cite>` element first**, so a comma or bracket inside a
  citation's own text — `(Boisvert, 2000)` — can't be read as a separator.
- A **locator must open** with a page marker (`p.`, `pp.`, `chap.`, `sec.`), a bare
  number, or a roman numeral, so `and others disagree` is not swallowed. Roman numerals
  are matched as real numerals: `[ivxlcdm]+` would also match _civil_, _mill_ and _ill_.
- A **lift needs the whole parenthesised span** to be citations and filler. Anything
  longer is left alone.
- **`and` between two keys becomes `;`.** MyST reads only `;` there; given
  `[see also @a and @b]` it looks for a label that does not exist and Typst then refuses
  to build the document at all — one connective costs the whole PDF.

## Workdir layout

After `improve`, the workdir (default `_improved/`) contains:

```
_improved/
  myst.yml
  meta-jdh.yml            # the repo's own, else the bundled default
  article.md
  references.bib          # notebook citation items not covered by an author .bib
  direct.bib              # author .bib files copied from the repo (references.bib → references.author.bib)
  plugins/
    hermeneutics.mjs
    jdh-dialogue.mjs
    jdh-table.mjs
    narrative-code.mjs
    hide-figure-code.mjs
    jdh-figures.mjs
    lib/table-truncate.mjs
    lib/typst-text.mjs
  data/                   # mirrored from project root when present
  notebook-outputs/       # figure images decoded from notebook outputs
  generated/              # QR / fingerprint: the repo's own, else generated, else bundled placeholders
  .gitignore              # `*`, keeps the workdir out of the article repo
```

## Source tagging → directives

| Jupytext source                                                               | Pipeline step               | MyST output                                                       |
| ----------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `#region` with `table-*` tags (numbered or descriptive), holding only a table | `improveJupytextTables`     | ` ```{jdh-table} `                                                |
| Code cell tagged `table-*`                                                    | `improveNotebookTables`     | `:::{jdh-table}` from its notebook output                         |
| Cell tagged `figure-*` (numbered or descriptive), `video-*` or `sound-*`      | `improveNotebookFigures`    | ` ```{figure} ` (placeholder and online link for video and audio) |
| Region tagged `dialog-*`                                                      | `improveDialogueRegions`    | ` ```{jdh-dialogue} `                                             |
| Region/cell tagged `hermeneutics`                                             | `improveHermeneuticsBlocks` | `:::{hermeneutics}`                                               |

The `hermeneutics` tag is found wherever `tags=[…]` sits on the fence, so a cell that also
carries Jupytext's `editable=`, `slideshow=` or `jdh=` attributes is wrapped like any other;
the other attributes are left as the author wrote them.
| Untagged fenced code | — (hand-authored) | Plain ` ```lang ` → narrative-code transform |

Hand-written `:::{table}` directives in article source are **not** converted to `jdh-table`; only pipeline-produced table regions are.

## Figures and the notebook

The Jupytext markdown has cell code and tags but no outputs, so the figure step also reads `article.ipynb` and matches cells by tag.

- **Tags:** numbered (`figure-1-*`, `figure_1`, `fig:1`) and descriptive (`figure-cartoon-*`) tags both become `fig:…` labels; references such as `[this figure](#figure-cartoon-*)` are retargeted.
- **Captions,** in order: the `metadata={"jdh": …}` literal in the code; cell metadata `jdh.object.source` (also on the Jupytext fence line); output metadata in the notebook. Output metadata is written at execution time and can be older than edits to the code, so a warning is printed when the sources disagree.
- **Images:** a cell becomes a `{figure}` when its code displays an image file (`Image("…")` or `Image(filename="…")`); files outside the copied folders (e.g. saved next to the notebook) are copied into the workdir. Otherwise, or when that file is missing, the cell's notebook image output (`image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`) is decoded to `notebook-outputs/fig-<label>.<ext>` and used instead. With several image outputs, the first is used.
- **Interactive figures and video:** when a figure's only output is HTML or JavaScript (Plotly, Bokeh, maps, widgets), or the cell is tagged `video-*`, it becomes a numbered figure with a placeholder image at the full text width. Video is its own kind, numbered "Video N" (`project.numbering.video`, template `Video %s`). Interactive figures, video and audio share one placeholder style, a dashed box with the media's icon (`notebook-outputs/placeholder-interactive.svg`, `placeholder-video.svg`, `sound.svg`), agreed with JDH on 6 Nov 2026. The caption links to the cell in the online article (`<article URL>?idx=<cell index>`). Nothing is rendered: an image output in the notebook is used when present, otherwise the placeholder.
- **Audio:** cells tagged `sound-*` (or `audio-*`) become a figure of kind `sound`, numbered "Sound N" separately from figures (the workdir `myst.yml` registers `project.numbering.sound`, template `Sound %s`), with the shared placeholder (`notebook-outputs/sound.svg`). Under the caption, a "Listen to the audio online" link goes to the cell with `?idx=`. With no caption anywhere, it is "Audio recording.". A sound cell tagged `hermeneutics` stays inside its hermeneutics block. A figure that has both an image and an audio player (e.g. a waveform) keeps its image and gets the same link.
- **Figures in markdown cells:** a region tagged `figure-*` holding a single image (`![alt](src)`, local or remote) becomes a numbered `{figure}`. Its caption comes from the region's `jdh` metadata, else a descriptive alt text. MyST downloads remote images at build.
- **Left as code:** figure cells whose HTML output is a table and cells with no output at all. Size hints such as `w-904px` are not applied.
- **Logs:** `stream` and `error` outputs are never used.

## Table regions

Markdown cells tagged `table-*` become a `{jdh-table}` when the cell holds only a GFM table. A cell of prose with a table inside is left as it is.

- **Labels:** numbered tags as before; descriptive tags (`table-sequence-*`) become `table:sequence`. A repeated tag gets `-2`, `-3`.
- **Captions** come from the region's `jdh` metadata. A table without one is still converted, without a caption.
- **Hermeneutics:** the region markers are kept and the directive uses a backtick fence, so a `hermeneutics` tag on the same cell still wraps the table.
- **References:** links to the table's `anchor-*` tag (`[table 1](#anchor-table-overview)`) point at its label. Link text such as "table 1" becomes an auto-numbered reference.
- **Dialogue:** cells also tagged `dialog-*` are left for the dialogue step.

## Tables and the notebook

Code cells tagged `table-*` (any kernel language) are matched to `article.ipynb` by tag, like figures, and replaced by a `:::{jdh-table}` built from the output. The code is not shown in the PDF.

- **Labels:** `table-1-*`, `table_1`, `table-1` → `table:1`; descriptive tags such as `table-six-degrees-*` → `table:six-degrees`.
- **Output used:** the first HTML `<table>` (pandas `to_html`/display, pandas Styler, R data.frame); else a `text/markdown` table. Cell markup (links, line breaks) is flattened to text.
- **Tidying:** pandas' default `0, 1, 2…` index column and its `...` truncation row and column are dropped; a named index moves into the header; R's column-type row (`<chr>`) and its "A data.frame: N × M" caption are dropped. For a truncated pandas output, the `N rows × M columns` footer becomes `:total-rows:`, so "K rows more" counts the full table.
- **Captions:** as for figures (code literal, cell metadata, output metadata), then the table's own `<caption>`; with none, the table has no caption.
- **Left as code:** cells with no table in their output (e.g. only `print` logs), reported with the reason.

## Plugin deployment

`prepareWorkdir` copies every `templates/plugins/*.mjs` into the workdir. `initMystConfig` registers them in `myst.yml`:

```yaml
project:
  plugins:
    - plugins/hermeneutics.mjs
    - plugins/hide-figure-code.mjs
    - plugins/jdh-dialogue.mjs
    - plugins/jdh-figures.mjs
    - plugins/jdh-lists.mjs
    - plugins/jdh-table.mjs
    - plugins/narrative-code.mjs
```

Plugins take effect on `myst build`, not during `improve`.

## Adding a pipeline step or plugin

1. Add step under `src/steps/` and register in `src/rulesets/jupytext.ts`
2. For a new plugin: add `templates/plugins/your-plugin.mjs`, run `bun run build`
3. Document in [plugins/index.md](plugins/index.md) and any Typst support in `jdh-typst-template`

Table directive options and truncation rules: [plugins/jdh-table.md](plugins/jdh-table.md).
