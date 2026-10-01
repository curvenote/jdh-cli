---
title: Improve pipeline
---

# Improve pipeline

The **jupytext** ruleset runs 12 steps in order. Steps in `steps/common/` are shared; `steps/jupytext/` handle notebook regions and cell tags.

```bash
jdh-cli article.md --list-steps
```

## Step sequence

| # | Step | Emits directives / side effects |
| --- | --- | --- |
| 1 | Prepare workdir | Wipe workdir; copy input, assets, deploy `plugins/*.mjs` |
| 2 | Init myst.yml | Scaffold config; register all bundled plugins |
| 3 | Citations (jupyter-zotero) | `references.bib`; rewrite `<cite>` → MyST citations |
| 4 | Improve citation tags | Author–year citekeys |
| 5 | Extract jupytext frontmatter | Author/affiliation metadata → `myst.yml`; article title |
| 6 | Enrich affiliations (ROR) | ROR-backed affiliation objects in `myst.yml` |
| 7 | Extract jupytext parts | Page-level frontmatter from document parts |
| 8 | Improve notebook figures | `{figure}` only (no `{code-block}` for figure cells); reads `article.ipynb` for captions and reports figures it can't convert yet |
| 9 | Improve Jupytext tables | `:::{jdh-table}` for every table region |
| 10 | Improve hermeneutics blocks | `:::{hermeneutics}` for tagged regions/cells |
| 11 | Set project.github | `project.github` from git remote |
| 12 | Set DOI and website | `project.doi` from the JDH API, `project.social.url` = JDH article page (see [CLI](cli.md#doi-and-website)) |

Steps 8–10 are the **transform steps** that emit custom directives. See the plugin pages for syntax and options.

## Workdir layout

After `improve`, the workdir (default `_improved/`) contains:

```
_improved/
  myst.yml
  meta-jdh.yml            # the repo's own, else the bundled default
  article.md
  references.bib          # when citations present
  plugins/
    hermeneutics.mjs
    jdh-table.mjs
    narrative-code.mjs
    hide-figure-code.mjs
    lib/table-truncate.mjs
  data/                   # mirrored from project root when present
  generated/              # QR / fingerprint: the repo's own, else bundled placeholders
  .gitignore              # `*`, keeps the workdir out of the article repo
```

## Source tagging → directives

| Jupytext source | Pipeline step | MyST output |
| --- | --- | --- |
| `#region` with `table-*` tags | `improveJupytextTables` | `:::{jdh-table}` |
| Cell tagged `figure-*` (numbered or descriptive) | `improveNotebookFigures` | `` ```{figure} `` |
| Region/cell tagged `hermeneutics` | `improveHermeneuticsBlocks` | `:::{hermeneutics}` |
| Untagged fenced code | — (hand-authored) | Plain `` ```lang `` → narrative-code transform |

Hand-written `:::{table}` directives in article source are **not** converted to `jdh-table`; only pipeline-produced table regions are.

## Figures and the notebook

The Jupytext markdown has cell code and tags but no outputs, so the figure step also reads `article.ipynb` and matches cells by tag.

- **Tags:** numbered (`figure-1-*`, `figure_1`, `fig:1`) and descriptive (`figure-cartoon-*`) tags both become `fig:…` labels; references such as `[this figure](#figure-cartoon-*)` are retargeted.
- **Captions,** in order: the `metadata={"jdh": …}` literal in the code; cell metadata `jdh.object.source` (also on the Jupytext fence line); output metadata in the notebook. Output metadata is written at execution time and can be older than edits to the code, so a warning is printed when the sources disagree.
- **Images:** a cell becomes a `{figure}` when its code displays an image file (`Image("…")` or `Image(filename="…")`). Files outside the copied folders (e.g. saved next to the notebook) are copied into the workdir. If the file can't be found, the cell is left as code.
- **Not yet converted:** cells whose figure exists only as a notebook output (matplotlib `image/png`, Plotly or Bokeh HTML) are left as code, and the step lists them with their output MIME types. Rendering those is planned (JDH-002, JDH-004).
- **Logs:** `stream` and `error` outputs are never used.

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
