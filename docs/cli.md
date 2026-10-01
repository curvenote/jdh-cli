---
title: CLI usage
---

# CLI usage

## Commands

| Command | Description |
| --- | --- |
| `jdh-cli init` | Optional: write `myst.yml` and `meta-jdh.yml` into an article repo to customise them |
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
| `--no-zotero` | Zotero data used | Ignore the notebook's Zotero data; use the repo's `.bib` files only |
| `--doi <doi>` | JDH API lookup | Set `project.doi`; accepts `10.…`, `doi:10.…` or a doi.org URL |
| `--url <url>` | JDH article page | Set the article URL (`project.social.url`) |
| `--list-steps` | off | List pipeline steps and exit |

### DOI and URL

The last step sets the article's DOI and URL in `_improved/myst.yml`. The JDH article id is read from the repo name (`origin` remote, else the project folder name), e.g. `BHmHNQKJaSWT` from `jdh-observer/BHmHNQKJaSWT` or `jdh001-L2gBr3BzwH8Z`.

| Field | Written to | Source, in order |
| --- | --- | --- |
| DOI | `project.doi` | `--doi`, then the JDH API (`/api/articles/<id>/` → `citation.URL`) |
| URL | `project.social.url` | `--url`, then `https://journalofdigitalhistory.org/en/article/<id>` |

The API only lists published articles, so during production pass `--doi` (and `--url`) explicitly. If no DOI is found the step logs a warning and the PDF shows "DOI unknown".

```bash
jdh-cli article.md --doi 10.1515/jdh-2025-0002
jdh-cli article.md --url https://journalofdigitalhistory.org/en/article/BHmHNQKJaSWT
```

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
jdh-cli build --template /path/to/jdh-typst-template
```

Requires a prior `improve` run and the [MyST CLI](https://mystmd.org). By default the template is `jdh-typst-template` checked out next to jdh-cli; `--template` overrides it (relative to the workdir unless absolute). Before building, the workdir's PDF export is pointed at that template, so article repos never hard-code its location.

## Article repo integration

None needed. Run jdh-cli from a plain JDH article repo; it supplies `meta-jdh.yml`, placeholder `generated/` images, plugins and config in the workdir, and writes `_improved/.gitignore`. Files the article repo does provide (its own `meta-jdh.yml`, `myst.yml` or `generated/` images) take precedence.

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
