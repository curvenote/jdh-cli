# MyST plugins (JDH)

> **Full documentation:** browse the [jdh-cli docs site](index.md) (`myst build --html` from `docs/`).
> Per-plugin pages: [overview](plugins/index.md) · [hermeneutics](plugins/hermeneutics.md) · [jdh-table](plugins/jdh-table.md) · [narrative-code](plugins/narrative-code.md) · [hide-figure-code](plugins/hide-figure-code.md)

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

See linked pages above for directive syntax, options tables, and Typst behaviour.

## Adding a new plugin

1. Add `templates/plugins/your-plugin.mjs`
2. `bun run build` (copies to `dist/plugins/`)
3. Plugins auto-deploy on next `improve` and auto-register in `_improved/myst.yml`
4. Document behaviour in `docs/plugins/` and any Typst support needed in `jdh-typst-template`

## Theme tuning (Typst)

See [typst.md](typst.md) for `jdh-theme.*` tokens in `jdh-typst-template`.
