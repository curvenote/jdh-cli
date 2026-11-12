---
title: Typst integration
---

# Typst integration

PDF export uses [`jdh-typst-template`](../../jdh-typst-template), checked out next to jdh-cli. `meta-jdh.yml` (bundled with jdh-cli) configures the export; `jdh-cli build` rewrites its `template:` to the resolved template path:

```yaml
exports:
  - format: pdf
    template: ../../jdh-typst-template
    article: article.md
    output: article.pdf
```

`jdh-cli build` runs `myst build --pdf` with `TYPST_FONT_PATHS` pointing at the template's Fira Code fonts.

## How the template is found

The template is a separate repo and is **not bundled** in jdh-cli.

- Default: `../jdh-typst-template` relative to the jdh-cli checkout. Override with `jdh-cli build --template <path>` (absolute, or relative to the article repo). A missing template fails the build with `Typst template not found`.
- Every `exports[].template` in `_improved/`'s config is rewritten to that absolute path, so article repos never reference the template.
- The template isn't pinned: jdh-cli uses whatever is checked out. The bundled plugins emit Typst that `jdh.typ` renders (see the mapping below), so keep the two repos in step.

## Template sources MyST accepts

An export's `template:` can take three forms, which are the options for shipping the template with jdh-cli in future:

```yaml
project:
  exports:
    - format: typst
      template: ../jdh-typst-template   # local folder containing template.yml (used today)
      # template: https://github.com/curvenote/jdh-typst-template/archive/refs/tags/v1.0.0.zip
      # template: lapreprint-typst       # name from the public MyST template registry
```

A zip URL (e.g. a GitHub tag archive) is downloaded and cached under `_build/templates/`, giving a versioned template with no separate checkout. Not yet tested with jdh-cli: `TYPST_FONT_PATHS` would need to follow the downloaded copy, and the first build needs network access. The alternative is copying a pinned template into `templates/typst/` when jdh-cli is packaged.

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
- `jdh-typst-template` next to jdh-cli (or pass `--template` to `jdh-cli build`)
- the QR code and fingerprint: `--qr-code` / `--fingerprint` (path or URL), else `generated/qr.png` and `generated/fingerprint.png` in the article repo, else clearly marked placeholders (with a warning). See [CLI](cli.md#qr-code-and-fingerprint)

## HTML export

Not a current target. Plugin transforms are Typst-oriented; HTML would need separate theme work.
