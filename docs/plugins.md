# MyST plugins (JDH)

jdh-cli bundles MyST JavaScript plugins under `templates/plugins/` (including
`plugins/lib/` helpers). On every `improve` run, `prepareWorkdir` copies the
plugin tree into `_improved/plugins/` and `initMystConfig` registers top-level
`*.mjs` plugins in `myst.yml`.

**Article repos do not ship their own `plugins/` directory.** Any local
`plugins/` folder in an article repo is ignored; add or extend plugins in
jdh-cli instead (see [Adding a new plugin](#adding-a-new-plugin)).

Plugins run at **MyST build time** (not during `improve`). They shape the AST
and insert Typst-specific `raw` nodes for PDF export via `jdh-typst-template`.

Typst/HTML styling for HTML is out of scope for now; PDF (Typst) is the target.

## Plugin overview

| Plugin | File | When it runs | Purpose |
| --- | --- | --- | --- |
| Hermeneutics | `hermeneutics.mjs` | MyST build | `:::{hermeneutics}` → cyan commentary blocks + sidebar code markers |
| Narrative code | `narrative-code.mjs` | MyST build | Gray full-bleed styling for eligible block code (except hermeneutics / figure) |
| JDH table | `jdh-table.mjs` | MyST build | `:::{jdh-table}` → row/column truncation + Typst styling |
| Hide figure code | `hide-figure-code.mjs` | MyST build | Removes legacy `code:fig:*` blocks from the AST (PDF safety net) |

## Hermeneutics

**Source tagging (improve pipeline):** Jupytext regions or fenced cells tagged
`hermeneutics` are wrapped in `:::{hermeneutics}` by the
`improveHermeneuticsBlocks` step.

**Plugin:** Registers the `hermeneutics` directive → `block[kind=hermeneutics]`.
A document transform inserts `#hermeneutics-block[...]` raw Typst wrappers.

**Typst:** `#hermeneutics-block` in `jdh.typ` — cyan fill, right bleed, optional
sidebar “HERMENEUTICS CODE EXCERPT / END” markers on code inside the block.

See also: [MyST blocks](https://mystmd.org/guide/blocks),
[JavaScript plugins](https://mystmd.org/guide/javascript-plugins).

## Narrative code

**What it is:** Code shown to the reader as part of the argument — plain
monospace, gray background bleeding to the right page edge, no syntax
highlighting, with truncation/fade controlled by `jdh-theme.code` in
`jdh-typst-template`.

**Eligibility (both produce the same styling):**

- Untagged fenced code blocks (e.g. `` ```python ``)
- Fences explicitly tagged `narrative` (`` ```python tags=["narrative"] ``)

**Scope:** Every eligible block-level `code` node in the document AST receives
narrative styling — not only top-level article body code. Code inside
admonitions, tab sets, tables, etc. is included unless excluded below.

**Excluded:**

- Code inside `:::{hermeneutics}` (handled by the hermeneutics plugin + template)
- Figure boilerplate (see below)

**Plugin:** Document transform wraps each eligible `code` AST node with:

```typst
#narrative-code-block[
  ...code...
]
```

**Typst:** `#narrative-code-block` in `jdh.typ` — gray fill (`#E8E8E8`), right
bleed, `spacing: 1em`. Truncation (`max-lines`, `fade-lines`, font size, “N lines
more”) reuses `jdh-theme.code` (shared with hermeneutics code inside cyan blocks).

## Figure cells — Option B (hide source code in PDF)

Notebook cells tagged as figures (e.g. `tags=["figure-1-*"]`) contain Python
that calls `display(Image(...))`. Readers should see the **figure image and
caption**, not the boilerplate source.

### Improve pipeline

`improveNotebookFigures` converts each figure-tagged cell to a single MyST
`{figure}` directive only. It **does not** write a companion `{code-block}` into
`_improved/article.md`.

Before (legacy):

```markdown
```{code-block} python
:label: code:fig:1
display(Image("./media/figure1.png", ...))
```

```{figure} ./media/figure1.png
:label: fig:1
Caption text
```
```

After (current):

```markdown
```{figure} ./media/figure1.png
:label: fig:1
Caption text
```
```

Cross-references in prose use `fig:N` / `[](#fig:1)`. Legacy links to the removed
figure `{code-block}` labels (`code:fig:N`, `{ref}\`code:fig:1\``) are rewritten to
the corresponding `fig:N` target during `improveNotebookFigures`.

### hide-figure-code.mjs (safety net)

If an article still contains a `{code-block}` labelled `code:fig:*` (hand-edited
or pre-migration workdir), this plugin **removes those nodes from the AST** before
Typst export so `display(Image(...))` never appears in the PDF.

This is **Option B**: figure source is hidden in PDF output; only `{figure}` renders.

### Why not narrative styling for figure code?

Figure cells are embedding boilerplate, not narrative code. Applying gray
full-bleed styling would show a redundant code box above every figure.

## JDH tables

**Improve pipeline:** `improveJupytextTables` converts every notebook table
`#region` into `:::{jdh-table}` (never `:::{table}`). Hand-written `:::{table}`
directives in article source are unchanged.

```markdown
:::{jdh-table} Absolute and relative frequencies…
:label: table:1
:max-rows: 4
:header-rows: 2
:align: center

| … | … |
| --- | --- |
| … | … |
:::
```

| Option | Default | Purpose |
| --- | --- | --- |
| `:max-rows:` | `4` (matches `jdh-theme.table.max-rows`) | Data rows shown before “K rows more” |
| `:header-rows:` | auto (rows before `\|---\|`; pandas double-separator pattern → 2) | Multi-row headers |
| `:max-rows: 0` | — | Disable row truncation |

**Plugin:** Mirrors the built-in `{table}` directive AST (caption + label + enumeration
options), then truncates rows/columns (`plugins/lib/table-truncate.mjs`), rebuilds
the table AST, and emits one Typst `raw` block (inside a one-child `div`)
with `#jdh-table-enter`, `#tablex(...)`, and `#jdh-table-footer()`.

**Column truncation:** When source columns exceed `jdh-theme.table.max-columns`
(default 6), shows `ceil((n-1)/2)` from the start, an ellipsis column (`…`), and
`floor((n-1)/2)` from the end — ellipsis included in the `n` column budget (6 visible
cells total when `max-columns` is 6).

**Typst:** `#jdh-table-style` / `#jdh-table-shell` / `#jdh-table-more-cell` in `jdh.typ` — tablex zebra rows, bold headers, no gridlines,
gray border with slight inset; “K rows more” is a full-width tablex row (not a separate block).

## Adding a new plugin

1. Add `templates/plugins/your-plugin.mjs`
2. `bun run build` (copies to `dist/plugins/`)
3. Plugins auto-deploy on next `improve` and auto-register in `_improved/myst.yml`
4. Document behaviour here and any Typst support needed in `jdh-typst-template`

## Theme tuning (Typst)

Shared code truncation — `jdh-theme.code` in `jdh-typst-template/jdh.typ`:

- `font`, `size`, `line-height`
- `max-lines`, `fade-lines`
- `more-text-size`, etc.

Container fills (independent):

- `jdh-theme.hermeneutics` — cyan blocks + code-marker sidebar
- `jdh-theme.narrative-code` — gray narrative code blocks
- `jdh-theme.table` — truncation defaults, zebra striping, “K rows more” footer
