---
title: Typst integration
---

# Typst integration

PDF export uses the sibling [`jdh-typst-template`](../../jdh-typst-template) package. `meta-jdh.yml` (bundled with jdh-cli) configures the export:

```yaml
exports:
  - format: pdf
    template: ../../jdh-typst-template
    article: article.md
    output: article.pdf
```

`jdh-cli build` runs `myst build --pdf` with `TYPST_FONT_PATHS` pointing at the template's Fira Code fonts.

## Plugin → Typst mapping

| Plugin | Typst function | Theme token |
| --- | --- | --- |
| Hermeneutics | `#hermeneutics-block[...]` | `jdh-theme.hermeneutics` |
| Narrative code | `#narrative-code-block[...]` | `jdh-theme.narrative-code`, `jdh-theme.code` |
| JDH table | `#jdh-table-enter` / `#tablex` / `#jdh-table-leave` | `jdh-theme.table` |
| Hide figure code | (node removal — no Typst output) | — |

Plugins insert `raw` nodes whose `typst` field `myst-to-typst` writes verbatim.

## Theme tuning

Shared code truncation — `jdh-theme.code` in `jdh.typ`:

| Token | Purpose |
| --- | --- |
| `font`, `size`, `line-height` | Monospace typography |
| `max-lines`, `fade-lines` | Truncation before fade |
| `more-text-size` | "N lines more" label size |

Container fills (independent):

| Token | Purpose |
| --- | --- |
| `jdh-theme.hermeneutics` | Cyan blocks + code-marker sidebar |
| `jdh-theme.narrative-code` | Gray narrative code blocks |
| `jdh-theme.table` | `max-rows`, `max-columns`, zebra striping, "K rows more" footer |

Table truncation defaults in the plugin (`max-rows: 4`, `max-columns: 6`) align with `jdh-theme.table` unless overridden per directive.

## Prerequisites

- [MyST CLI](https://mystmd.org) installed globally or on `PATH`
- `jdh-typst-template` at `../../jdh-typst-template` relative to `_improved/` (or pass `--template` to `jdh-cli build`)

## HTML export

Not a current target. Plugin transforms are Typst-oriented; HTML would need separate theme work.
