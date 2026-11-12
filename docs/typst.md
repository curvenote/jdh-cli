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

The template is a separate repo; jdh-cli doesn't bundle it. `jdh-cli build --template` picks it:

| `--template` | Template | `TYPST_FONT_PATHS` | MyST command |
| --- | --- | --- | --- |
| omitted | `../jdh-typst-template` next to jdh-cli | `<template>/fonts/fira_code` | `myst build --pdf` |
| a path | that folder (absolute, or relative to the workdir) | `<template>/fonts/fira_code` | `myst build --pdf` |
| a zip URL | downloaded by MyST to `_build/templates/typst/<sha256 of URL>/` | that folder's `fonts/fira_code` | `myst build --typst` |

Every `exports[].template` in the workdir config is rewritten to the chosen template, so article repos never reference it. A missing local template fails the build with `Typst template not found`.

A checkout isn't pinned: jdh-cli uses whatever is checked out, and the bundled plugins emit Typst that `jdh.typ` renders (see the mapping below), so keep the two in step. A release URL pins the version.

## Using a release zip

```bash
jdh-cli build --template https://github.com/curvenote/jdh-typst-template/archive/refs/tags/v0.1.0.zip
```

MyST accepts a zip URL as an export's `template:`, downloads it on the first build (network needed) and caches it. Two things don't happen automatically, so jdh-cli does them:

- **Format.** With `format: pdf` and a URL, MyST assumes a LaTeX template and fails. jdh-cli sets the export's `format: typst` and runs `myst build --typst`.
- **Fonts.** MyST runs `typst compile` without `--font-path` and ignores the template's `font-paths.txt`, so Typst finds only `TYPST_FONT_PATHS`, system fonts and its built-in fonts (Libertinus Serif, New Computer Modern, DejaVu Sans Mono). The cache folder is named by the SHA-256 of the URL, so jdh-cli sets `TYPST_FONT_PATHS` to `<cache>/fonts/fira_code` before the download; Typst only reads it when compiling.

The other form MyST accepts is a name from the public MyST template registry (e.g. `lapreprint-typst`); the JDH template isn't listed there.

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
- [Typst](https://typst.app) on the PATH (`typst`, e.g. `brew install typst`); MyST runs `typst compile` and doesn't install it
- `jdh-typst-template` next to jdh-cli, or `--template` with another path or a release zip URL
- the QR code and fingerprint: `--qr-code` / `--fingerprint` (path or URL), else `generated/qr.png` and `generated/fingerprint.png` in the article repo, else clearly marked placeholders (with a warning). See [CLI](cli.md#qr-code-and-fingerprint)

## HTML export

Not a current target. Plugin transforms are Typst-oriented; HTML would need separate theme work.
