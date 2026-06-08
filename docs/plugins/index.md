---
title: Plugins overview
---

# Plugins & directives

jdh-cli bundles four MyST JavaScript plugins under `templates/plugins/`. On every `improve` run they are copied to `_improved/plugins/` and registered in `myst.yml`.

**Article repos do not ship their own `plugins/` directory.** Extend plugins in jdh-cli, then rebuild and re-run `improve`.

Plugins run at **MyST build time**. They shape the AST and insert Typst `raw` nodes for PDF export via [`jdh-typst-template`](../../jdh-typst-template). HTML styling is out of scope; PDF (Typst) is the target.

## Summary

| Plugin | File | Type | Pipeline emits? | Purpose |
| --- | --- | --- | --- | --- |
| [Hermeneutics](hermeneutics.md) | `hermeneutics.mjs` | directive + transform | Yes | Cyan commentary blocks |
| [JDH table](jdh-table.md) | `jdh-table.mjs` | directive + transform | Yes | Row/column truncation + Typst tablex |
| [Narrative code](narrative-code.md) | `narrative-code.mjs` | transform only | No | Gray full-bleed code styling |
| [Hide figure code](hide-figure-code.md) | `hide-figure-code.mjs` | transform only | No (safety net) | Remove legacy `code:fig:*` blocks |

## Directive vs transform

- **Directives** — parsed from markdown (`:::{name}` or `` ```{name} ``); registered in the plugin's `directives` array.
- **Transforms** — document-stage AST walkers; no author-facing syntax.

## Shared library

`plugins/lib/table-truncate.mjs` is not a plugin. It provides GFM parsing and truncation math used by `jdh-table.mjs` and tested independently.

## Adding a new plugin

1. Add `templates/plugins/your-plugin.mjs`
2. `bun run build` (copies to `dist/plugins/`)
3. Plugins auto-deploy on next `improve` and auto-register in `_improved/myst.yml`
4. Document behaviour here and any Typst support in `jdh-typst-template`

## Further reading

- [Improve pipeline](../pipeline.md) — which steps emit directives
- [Typst integration](../typst.md) — theme tokens and template functions
- [JDH table design spec](../superpowers/specs/2026-06-07-jdh-table-design.md) — full truncation/styling design
