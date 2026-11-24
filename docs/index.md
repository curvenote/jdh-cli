---
title: Overview
---

# jdh-cli

**jdh-cli** converts Jupytext-exported notebooks into a MyST-ready article project: `myst.yml`, `article.md`, bundled plugins, and assets in a pipeline workdir (default `_improved/`).

All pipeline logic lives in this package (`src/steps/`). Article repos need no setup: run `jdh-cli` from a plain JDH article repo and it supplies the rest in the workdir.

## What it produces

| Output | Location | Purpose |
| --- | --- | --- |
| `myst.yml` | workdir | Project config, plugin registration, PDF export |
| `meta-jdh.yml` | workdir | Shared JDH defaults (license, PDF export); bundled unless the repo has its own |
| `generated/*.png` | workdir | QR code and fingerprint; the repo's own, else generated, else placeholders |
| `article.md` | workdir | Improved MyST markdown |
| `plugins/*.mjs` | workdir | Bundled MyST plugins (copied on every run) |
| `references.bib` | workdir | BibTeX from the notebook's citation metadata, `citation-manager` or cite2c (when present) |

## Quick start

```bash
cd jdh-cli && bun run build && bun link   # build CLI and put jdh-cli on PATH
cd path/to/article-repo
jdh-cli article.md                        # convert into _improved/
jdh-cli build                             # myst build --pdf
```

Prerequisites for PDF builds: [MyST CLI](https://mystmd.org) 1.10 or later and [Typst](https://typst.app) 0.15.x on the PATH (`jdh-cli build` checks both and says what to install), plus [`jdh-typst-template`](../../jdh-typst-template) checked out next to jdh-cli. See [Typst version](typst.md#typst-version).

## Documentation map

- **[CLI commands](cli.md)** — `init`, convert, `clean`, `build`
- **[Improve pipeline](pipeline.md)** — 12-step jupytext ruleset
- **[Plugins & directives](plugins/index.md)** — custom MyST extensions shipped with jdh-cli
- **[Typst integration](typst.md)** — PDF styling via `jdh-typst-template`

## Plugin model

Plugins run at **MyST build time** (not during `improve`). They shape the AST and insert Typst-specific `raw` nodes for PDF export. Article repos do not ship their own `plugins/` directory — add or extend plugins in jdh-cli instead.

See [plugins/index.md](plugins/index.md) for the full reference.
