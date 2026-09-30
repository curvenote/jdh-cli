---
title: Overview
---

# jdh-cli

**jdh-cli** converts Jupytext-exported notebooks into a MyST-ready article project: `myst.yml`, `article.md`, bundled plugins, and assets in a pipeline workdir (default `_improved/`).

All pipeline logic lives in this package (`src/steps/`). Article repos depend on jdh-cli as a dev dependency and call it via `npm run improve` / `npm run build`.

## What it produces

| Output | Location | Purpose |
| --- | --- | --- |
| `myst.yml` | workdir | Project config, plugin registration, PDF export |
| `meta-jdh.yml` | workdir | Shared JDH defaults (license, PDF template) |
| `article.md` | workdir | Improved MyST markdown |
| `plugins/*.mjs` | workdir | Bundled MyST plugins (copied on every run) |
| `references.bib` | workdir | BibTeX from Zotero citations (when present) |

## Quick start

```bash
cd jdh-cli && bun run build          # build CLI + copy templates
cd ../article-repo && npm install    # jdh-cli as file:../jdh-cli
npm run improve                      # jdh-cli article.md --project-root .
npm run build                        # jdh-cli build → myst build --pdf
```

Prerequisites: [MyST CLI](https://mystmd.org) for PDF builds; sibling [`jdh-typst-template`](../../jdh-typst-template) for Typst export.

## Documentation map

- **[CLI commands](cli.md)** — `init`, convert, `clean`, `build`
- **[Improve pipeline](pipeline.md)** — 11-step jupytext ruleset
- **[Plugins & directives](plugins/index.md)** — custom MyST extensions shipped with jdh-cli
- **[Typst integration](typst.md)** — PDF styling via `jdh-typst-template`

## Plugin model

Plugins run at **MyST build time** (not during `improve`). They shape the AST and insert Typst-specific `raw` nodes for PDF export. Article repos do not ship their own `plugins/` directory — add or extend plugins in jdh-cli instead.

See [plugins/index.md](plugins/index.md) for the full reference.
