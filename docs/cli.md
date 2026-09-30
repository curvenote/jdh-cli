---
title: CLI usage
---

# CLI usage

## Commands

| Command | Description |
| --- | --- |
| `jdh-cli init` | Create `myst.yml` and copy bundled `meta-jdh.yml` for a new article repo |
| `jdh-cli <file.md>` | Run the jupytext conversion pipeline (default workdir `_improved/`) |
| `jdh-cli clean` | Remove the pipeline workdir and legacy `.bak` files |
| `jdh-cli build` | Build PDF from the workdir via `myst build --pdf` |

## Convert (`jdh-cli <file.md>`)

The primary entry point. Infers the `jupytext` ruleset for `.md` inputs and writes outputs to the workdir.

```bash
jdh-cli article.md
jdh-cli article.md --project-root ./article --workdir _improved
jdh-cli article.md --list-steps          # print planned steps, no writes
jdh-cli article.md --dry-run             # log actions without writing
```

| Option | Default | Description |
| --- | --- | --- |
| `--workdir <path>` | `_improved` | Output directory (relative to project root) |
| `--project-root <path>` | input directory | Article repo root for assets |
| `-d, --dry-run` | off | Preview without writing files |
| `--orcid-lookup` | off | Enable ORCID enrichment in frontmatter step |
| `--ror-lookup` / `--no-ror-lookup` | on | ROR affiliation resolution |
| `--ror-min-score <float>` | `0.8` | ROR match threshold (0–1) |
| `--list-steps` | off | List pipeline steps and exit |

## Init (`jdh-cli init`)

Scaffolds a new article repo when no `myst.yml` exists yet.

```bash
jdh-cli init            # current directory
jdh-cli init ../my-article
```

Creates `myst.yml` (with `extends: meta-jdh.yml`) and copies the bundled `meta-jdh.yml`. Reports "already initialized" if `myst.yml` or legacy `curvenote.yml` is present.

## Clean (`jdh-cli clean`)

```bash
jdh-cli clean --project-root .
jdh-cli clean --workdir _improved
```

## Build (`jdh-cli build`)

Runs `myst build --pdf` in the workdir with `TYPST_FONT_PATHS` set for Fira Code.

```bash
jdh-cli build
jdh-cli build --project-root . --workdir _improved
jdh-cli build --template ../../jdh-typst-template
```

Requires a prior `improve` run and the [MyST CLI](https://mystmd.org). The Typst template must exist at the path given by `--template` (default `../../jdh-typst-template` relative to the workdir).

## Article repo integration

```json
{
  "scripts": {
    "improve": "jdh-cli article.md --project-root .",
    "clean": "jdh-cli clean --project-root .",
    "build": "jdh-cli build --project-root .",
    "ib": "npm run improve && npm run build"
  },
  "devDependencies": {
    "jdh-cli": "file:../jdh-cli"
  }
}
```

## Development

```bash
cd jdh-cli
bun install
bun run compile
bun run build
bun test
bun src/index.ts --help
bun src/index.ts ../article/article.md --list-steps --project-root ../article
```
