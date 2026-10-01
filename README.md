# jdh-cli

Turns a Journal of Digital History article repo (Jupytext `article.md` + `article.ipynb`) into a MyST project and builds the JDH PDF with the Typst template. Article repos need no setup; jdh-cli supplies the configuration, plugins and defaults in a working folder (`_improved/`).

## Getting started

**Prerequisites:** [Bun](https://bun.sh), the [MyST CLI](https://mystmd.org) (`myst`) for PDF builds, and [`jdh-typst-template`](https://github.com/curvenote/jdh-typst-template) checked out next to `jdh-cli`.

```bash
# once: build jdh-cli and put it on your PATH
cd jdh-cli
bun install
bun run build
bun link

# in any JDH article repo
cd path/to/article-repo
jdh-cli article.md        # convert into _improved/
jdh-cli build             # → _improved/article.pdf
```

### Commands

| Command | What it does | Common options |
| --- | --- | --- |
| `jdh-cli article.md` | Convert the article: runs the 12-step pipeline into `_improved/` | `--doi`, `--url`, `--no-ror-lookup`, `--list-steps`, `--dry-run` |
| `jdh-cli build` | Build the PDF from `_improved/` with `myst build --pdf` | `--template <path>` |
| `jdh-cli clean` | Delete `_improved/` | `--dry-run` |
| `jdh-cli init [dir]` | Optional: write `myst.yml` and `meta-jdh.yml` into the article repo, to customise or iterate in place | |
| `jdh-cli --help` | Help for any command (`jdh-cli build --help`) | `--version` |

Convert, `build` and `clean` also accept `--project-root <path>` (default: the input file's folder for convert, the current folder for `build` and `clean`) and `--workdir <path>` (default `_improved`).

### Convert options

| Option | Default | Description |
| --- | --- | --- |
| `--doi <doi>` | Looked up from the JDH API | Set the article DOI (`project.doi`). Accepts `10.…`, `doi:10.…` or a doi.org URL |
| `--url <url>` | JDH article page from the repo name | Set the article URL (`project.social.url`) |
| `--no-zotero` | Zotero data used | Ignore the notebook's Zotero data and rely on the repo's `.bib` files. For articles that cite `[@key]` directly; `<cite>` tags then become plain text |
| `--no-ror-lookup` | ROR lookups on | Skip resolving affiliations via the ROR API (faster, offline) |
| `--ror-min-score <0..1>` | `0.8` | ROR match threshold |
| `--orcid-lookup` | off | Enrich authors via ORCID |
| `--list-steps` | | Print the pipeline steps and exit |
| `-d, --dry-run` | | Show what would happen without writing files |

The DOI and URL come from the JDH API using the article ID in the repo name (e.g. `jdh-observer/BHmHNQKJaSWT`). During production, before an article is published, pass `--doi` (and `--url`) explicitly:

```bash
jdh-cli article.md --doi 10.1515/jdh-2025-0002 --url https://journalofdigitalhistory.org/en/article/BHmHNQKJaSWT
```

## What jdh-cli supplies

A plain JDH article repo is enough. In `_improved/`, jdh-cli adds:

- the bundled `meta-jdh.yml` (licence, PDF export), unless the repo has its own
- placeholder `generated/qr.png` and `generated/fingerprint.png`, unless the repo has its own
- `myst.yml` with authors, affiliations, DOI, URL and GitHub link
- the MyST plugins for hermeneutics blocks, narrative code and JDH tables
- `references.bib` from the notebook's Zotero (citation-manager) data, plus any `.bib` files in the article repo (e.g. `direct.bib`)
- a `.gitignore`, so the article repo stays clean

`jdh-cli build` points the PDF export at `jdh-typst-template` next to jdh-cli; pass `--template` to use another copy.

**References.** Any `.bib` in the article repo is used alongside the notebook's Zotero data. When both describe the same work (same DOI, else same title and year), the repo's `.bib` entry wins. A citation whose plugin mapping was lost is recovered from the Zotero key in its link; one that can't be found anywhere is kept as its visible text, with a warning.

Files the article repo provides take precedence. With `jdh-cli init`, edits to the repo's `meta-jdh.yml` are used. From the repo's `myst.yml`, only `project.id` is kept today; keeping other edits is planned.

## Design rules

- **The article repo is the input.** jdh-cli works from `article.md`, `article.ipynb` and other files in the article folder. Content a notebook can't provide as data (e.g. an interactive chart with no image output) becomes a placeholder linking to the online article; it isn't rendered or fetched.
- **No Python dependencies** in the processing chain.
- Current network lookups, under review against the first rule: DOI from the JDH API (`--doi` overrides), ROR affiliations (`--no-ror-lookup` disables), ORCID (`--orcid-lookup`, off by default).

## Pipeline

`jdh-cli article.md --list-steps` prints the 12 steps: prepare workdir, init `myst.yml`, citations, citation keys, front matter, ROR affiliations, document parts, figures, tables, hermeneutics blocks, GitHub link, DOI and URL. Figures read `article.ipynb` for captions and report figures that exist only as notebook output.

## Documentation

[docs/](docs/) is a MyST site covering CLI usage, the pipeline, plugins and directives, and Typst integration. Build it with `cd docs && myst build --html`.

## Development

```bash
cd jdh-cli
bun install
bun run compile            # type-check
bun run lint
bun test
bun run build              # production build of dist/
bun run dev:build          # rebuild dist/ on every save
bun run dev                # bun link + dev:build
bun src/index.ts --help    # run from source
```

`test/build-integration.test.ts` builds a real PDF and needs `myst`, `../jdh-typst-template` and `../art-unpub/BHmHNQKJaSWT`; it skips itself when they're missing.

### Source layout

```
jdh-cli/
  src/
    cli/                 error handling
    commands/            convert, init, clean, build
    engine/              runner, workdir, step context
    init/                bundled meta-jdh.yml, plugins and defaults
    rulesets/            step order for each ruleset (jupytext)
    steps/               self-contained pipeline steps
      common/            shared steps (one file each)
      jupytext/          notebook / region steps
      shared/            notebook reader, YAML read/write helpers, guards
  templates/             shipped assets (meta-jdh.yml, plugins/*.mjs, placeholder generated/*.png)
```

All pipeline logic lives in `src/steps/`.
