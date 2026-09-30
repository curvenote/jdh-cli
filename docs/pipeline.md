---
title: Improve pipeline
---

# Improve pipeline

The **jupytext** ruleset runs 11 steps in order. Steps in `steps/common/` are shared; `steps/jupytext/` handle notebook regions and cell tags.

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
| 8 | Improve notebook figures | `{figure}` only (no `{code-block}` for figure cells) |
| 9 | Improve Jupytext tables | `:::{jdh-table}` for every table region |
| 10 | Improve hermeneutics blocks | `:::{hermeneutics}` for tagged regions/cells |
| 11 | Set project.github | `project.github` from git remote |

Steps 8–10 are the **transform steps** that emit custom directives. See the plugin pages for syntax and options.

## Workdir layout

After `improve`, the workdir (default `_improved/`) contains:

```
_improved/
  myst.yml
  meta-jdh.yml
  article.md
  references.bib          # when citations present
  plugins/
    hermeneutics.mjs
    jdh-table.mjs
    narrative-code.mjs
    hide-figure-code.mjs
    lib/table-truncate.mjs
  data/                   # mirrored from project root when present
  generated/              # QR / fingerprint images when present
```

## Source tagging → directives

| Jupytext source | Pipeline step | MyST output |
| --- | --- | --- |
| `#region` with `table-*` tags | `improveJupytextTables` | `:::{jdh-table}` |
| Cell tagged `figure-*` | `improveNotebookFigures` | `` ```{figure} `` |
| Region/cell tagged `hermeneutics` | `improveHermeneuticsBlocks` | `:::{hermeneutics}` |
| Untagged fenced code | — (hand-authored) | Plain `` ```lang `` → narrative-code transform |

Hand-written `:::{table}` directives in article source are **not** converted to `jdh-table`; only pipeline-produced table regions are.

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
