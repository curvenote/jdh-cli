---
title: Improve pipeline
---

# Improve pipeline

The **jupytext** ruleset runs 13 steps in order. Steps in `steps/common/` are shared; `steps/jupytext/` handle notebook regions and cell tags.

```bash
jdh-cli article.md --list-steps
```

## Step sequence

| # | Step | Emits directives / side effects |
| --- | --- | --- |
| 1 | Prepare workdir | Wipe workdir; copy input, assets, deploy `plugins/*.mjs` |
| 2 | Init myst.yml | Scaffold config; register all bundled plugins |
| 3 | Citations (Zotero and author .bib) | `references.bib` from notebook Zotero data; registers the repo's `.bib` files (author entries replace duplicates); rewrite `<cite>` → MyST citations, unresolved ones → plain text |
| 4 | Improve citation tags | Author–year citekeys |
| 5 | Extract jupytext frontmatter | Every `contributor` cell → `myst.yml` authors (name, ORCID, email, affiliations); title and keywords; the regions are removed from the article |
| 6 | Enrich affiliations (ROR) | ROR-backed affiliation objects in `myst.yml` |
| 7 | Extract jupytext parts | Page-level frontmatter from document parts |
| 8 | Improve notebook figures | `{figure}` only (no `{code-block}` for figure cells); reads `article.ipynb` for captions and reports figures it can't convert yet |
| 9 | Improve notebook tables | `:::{jdh-table}` from the notebook output of table-tagged code cells (pandas, HTML or markdown tables); the code is dropped |
| 10 | Improve Jupytext tables | `:::{jdh-table}` for every table region; `Table N` references → label links for all tables |
| 11 | Improve hermeneutics blocks | `:::{hermeneutics}` for tagged regions/cells |
| 12 | Set project.github | `project.github` from git remote |
| 13 | Set DOI and website | `project.doi` from the JDH API, `project.social.url` = JDH article page (see [CLI](cli.md#doi-and-url)) |

Steps 8–11 are the **transform steps** that emit custom directives. See the plugin pages for syntax and options.

## Workdir layout

After `improve`, the workdir (default `_improved/`) contains:

```
_improved/
  myst.yml
  meta-jdh.yml            # the repo's own, else the bundled default
  article.md
  references.bib          # Zotero items not covered by an author .bib
  direct.bib              # author .bib files copied from the repo (references.bib → references.author.bib)
  plugins/
    hermeneutics.mjs
    jdh-table.mjs
    narrative-code.mjs
    hide-figure-code.mjs
    lib/table-truncate.mjs
  data/                   # mirrored from project root when present
  notebook-outputs/       # figure images decoded from notebook outputs
  generated/              # QR / fingerprint: the repo's own, else bundled placeholders
  .gitignore              # `*`, keeps the workdir out of the article repo
```

## Source tagging → directives

| Jupytext source | Pipeline step | MyST output |
| --- | --- | --- |
| `#region` with `table-*` tags | `improveJupytextTables` | `:::{jdh-table}` |
| Code cell tagged `table-*` | `improveNotebookTables` | `:::{jdh-table}` from its notebook output |
| Cell tagged `figure-*` (numbered or descriptive), `video-*` or `sound-*` | `improveNotebookFigures` | `` ```{figure} `` (placeholder and online link for video and audio) |
| Region/cell tagged `hermeneutics` | `improveHermeneuticsBlocks` | `:::{hermeneutics}` |
| Untagged fenced code | — (hand-authored) | Plain `` ```lang `` → narrative-code transform |

Hand-written `:::{table}` directives in article source are **not** converted to `jdh-table`; only pipeline-produced table regions are.

## Figures and the notebook

The Jupytext markdown has cell code and tags but no outputs, so the figure step also reads `article.ipynb` and matches cells by tag.

- **Tags:** numbered (`figure-1-*`, `figure_1`, `fig:1`) and descriptive (`figure-cartoon-*`) tags both become `fig:…` labels; references such as `[this figure](#figure-cartoon-*)` are retargeted.
- **Captions,** in order: the `metadata={"jdh": …}` literal in the code; cell metadata `jdh.object.source` (also on the Jupytext fence line); output metadata in the notebook. Output metadata is written at execution time and can be older than edits to the code, so a warning is printed when the sources disagree.
- **Images:** a cell becomes a `{figure}` when its code displays an image file (`Image("…")` or `Image(filename="…")`); files outside the copied folders (e.g. saved next to the notebook) are copied into the workdir. Otherwise, or when that file is missing, the cell's notebook image output (`image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`) is decoded to `notebook-outputs/fig-<label>.<ext>` and used instead. With several image outputs, the first is used.
- **Interactive figures and video:** when a figure's only output is HTML or JavaScript (Plotly, Bokeh, maps, widgets), or the cell is tagged `video-*`, it becomes a numbered figure with a placeholder image (`notebook-outputs/placeholder-interactive.svg` / `placeholder-video.svg`). The caption links to the cell in the online article (`<article URL>?idx=<cell index>`). Nothing is rendered: an image output in the notebook is used when present, otherwise the placeholder.
- **Audio:** cells tagged `sound-*` (or `audio-*`) become a numbered figure labelled `aud:…` with an audio placeholder (`notebook-outputs/placeholder-audio.svg`). The caption ends "Listen to it in the online article." and links to the cell with `?idx=`. With no caption anywhere, the caption is "Audio recording.". A figure that has both an image and an audio player (e.g. a waveform) keeps its image and gets the same link.
- **Left as code:** figure cells whose HTML output is a table and cells with no output at all. Size hints such as `w-904px` are not applied.
- **Logs:** `stream` and `error` outputs are never used.

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
    - plugins/jdh-table.mjs
    - plugins/narrative-code.mjs
```

Plugins take effect on `myst build`, not during `improve`.

## Adding a pipeline step or plugin

1. Add step under `src/steps/` and register in `src/rulesets/jupytext.ts`
2. For a new plugin: add `templates/plugins/your-plugin.mjs`, run `bun run build`
3. Document in [plugins/index.md](plugins/index.md) and any Typst support in `jdh-typst-template`

Table directive options and truncation rules: [plugins/jdh-table.md](plugins/jdh-table.md).
