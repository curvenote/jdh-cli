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

## Typst version

**Supported: Typst 0.15.x** (>= 0.15.0, < 0.16.0), with mystmd 1.10 or later.

`jdh-cli build` checks both before doing any work (`src/engine/toolchain.ts`) and prints
what it found:

```
Toolchain: MyST (mystmd) 1.10.1, Typst 0.15.1
```

A missing tool stops the build with install instructions. A version outside the tested
range only warns — the build still runs, because an untested Typst usually works; it just
has not been compared against the corpus.

### Why 0.15

The whole JDH corpus was rebuilt and compared page by page on 0.15.1 (JDH-050). 0.14.2
builds the same documents, but renders references worse:

| On 0.14.2 | On 0.15.1 |
| --- | --- |
| name particles dropped — `Lange, M. v.`, `Rio-Chanona, R. M. d.` | `van`, `del` restored |
| diacritics mis-sorted — Åberg, Šabec, Řehůřek out of place | sorted correctly |
| a journal title lost (*Semiotica*) | present |
| issue numbers corrupted — `jdh002` printed as `jdh2` | `(jdh002)` intact |
| an edition statement lost ("Third Edition") | present |

0.15.1 introduced one regression of its own: 22 references across the corpus print an
incomplete `Retrieved <url>` clause, missing the date and the word "from". It is an APA
deviation, not malformed output.

### Upgrading Typst

Typst bundles [hayagriva](https://github.com/typst/hayagriva) for bibliography rendering, so
**a Typst upgrade changes reference output** — that is where every difference in the table
above came from, not from the template. Before adopting a new Typst:

1. Rebuild the corpus (`scripts/build-articles.sh art-focus art-unpub`).
2. Diff the extracted text (`pdftotext`) against the previous run, not just page counts.
3. Update the range in `src/engine/toolchain.ts` and its test, the README, and this page.

### Known upstream faults on 0.15.1

Two APA punctuation faults remain, both in Typst's built-in style rather than our template,
and neither is worked around in the pipeline:

| Fault | Scope | Upstream |
| --- | --- | --- |
| stray comma — `Internet Archive Forums. (2014,).` | 15 references, 6 articles | fixed by [hayagriva#503](https://github.com/typst/hayagriva/pull/503), merged but not yet in a release |
| doubled stop — `…capturing duplicates?.` | 13 references, 6 articles | reported as [hayagriva#552](https://github.com/typst/hayagriva/issues/552) |

The comma clears itself on whatever Typst release first carries a newer hayagriva. Recount
both after any upgrade.

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
- [Typst](https://typst.app) **0.15.x** on the PATH (`typst`, e.g. `brew install typst`); MyST runs `typst compile` and doesn't install it. See [Typst version](#typst-version)
- `jdh-typst-template` next to jdh-cli, or `--template` with another path or a release zip URL
- the QR code and fingerprint: `--qr-code` / `--fingerprint` (path or URL), else `generated/qr.png` and `generated/fingerprint.png` in the article repo, else generated (QR code from the article URL, fingerprint from `article.ipynb`), else clearly marked placeholders (with a warning). See [CLI](cli.md#qr-code-and-fingerprint)

## HTML export

Not a current target. Plugin transforms are Typst-oriented; HTML would need separate theme work.
