# jdh-cli

Turns a Journal of Digital History article repo (Jupytext `article.md` + `article.ipynb`) into a MyST project and builds the JDH PDF with the Typst template. Article repos need no setup; jdh-cli supplies the configuration, plugins and defaults in a working folder (`_improved/`).

## Getting started

**Prerequisites:**
- [Bun](https://bun.sh).
- The [`jdh-typst-template`](https://github.com/curvenote/jdh-typst-template): either checked out next to `jdh-cli`, or fetched from a release with `jdh-cli build --template <zip URL>` (see [The Typst template](#the-typst-template)).
- For PDF builds, two tools on the PATH, which jdh-cli doesn't bundle:
  - the [MyST CLI](https://mystmd.org) (`myst`, mystmd 1.10 or later; `npm install -g mystmd`);
  - [Typst](https://typst.app) 0.15.x (`brew install typst`), which MyST runs.

  `jdh-cli build` checks both first. It stops with install instructions if either is missing, warns about an untested version, and prints the versions in the build log.

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
| `jdh-cli article.md` | Convert the article: runs the 18-step pipeline into `_improved/` | `--doi`, `--url`, `--qr-code`, `--fingerprint`, `--table-max-rows`, `--no-ror-lookup`, `--list-steps`, `--dry-run` |
| `jdh-cli build` | Build the PDF from `_improved/` with `myst build --pdf` | `--template <path or zip URL>`, `--figure-placement` |
| `jdh-cli clean` | Delete `_improved/` | `--dry-run` |
| `jdh-cli init [dir]` | Optional: write `myst.yml` and `meta-jdh.yml` into the article repo, to customise or iterate in place; hand edits there win over derived values ([details](docs/cli.md#iterate-in-place)) | |
| `jdh-cli --help` | Help for any command (`jdh-cli build --help`) | `--version` |

Convert, `build` and `clean` also accept `--project-root <path>` (default: the input file's folder for convert, the current folder for `build` and `clean`) and `--workdir <path>` (default `_improved`).

### Convert options

| Option | Default | Description |
| --- | --- | --- |
| `--doi <doi>` | Looked up from the JDH API | Set the article DOI (`project.doi`). Accepts `10.…`, `doi:10.…` or a doi.org URL |
| `--url <url>` | JDH article page from the repo name | Set the article URL (`project.social.url`) |
| `--qr-code <path\|url>` | Repo's `generated/qr.png`, else a placeholder | QR code image for the PDF sidebar: a local file or an http(s) URL. PNG, JPEG, GIF or SVG (checked by its bytes) |
| `--fingerprint <path\|url>` | Repo's `generated/fingerprint.png`, else a placeholder | Fingerprint image for the PDF sidebar, as for `--qr-code` |
| `--table-max-rows <n>` | `4` | Rows a table shows before "K rows more"; `0` shows every row. Applies to every table in the run; a table's own `:max-rows:` wins |
| `--no-zotero` | notebook metadata used | Ignore the notebook's citation metadata (both `citation-manager` and cite2c) and rely on the repo's `.bib` files. For articles that cite `[@key]` directly; `<cite>` tags then become plain text |
| `--no-ror-lookup` | ROR lookups on | Skip resolving affiliations via the ROR API (faster, offline) |
| `--ror-min-score <0..1>` | `0.8` | ROR match threshold |
| `--orcid-lookup` | off | Enrich authors via ORCID |
| `--list-steps` | | Print the pipeline steps and exit |
| `-d, --dry-run` | | Show what would happen without writing files |

The DOI comes from the JDH API (`/api/articles/<id>/?format=json`) using the article ID in the repo name (e.g. `jdh-observer/BHmHNQKJaSWT`); the URL is the article's JDH page. When the API can't supply a DOI (unreachable, article not found or not yet public, no usable `doi` field), jdh-cli prints a warning saying which and builds without one. `--doi` always wins, with no lookup. During production, before an article is published, pass `--doi` (and `--url`) explicitly:

```bash
jdh-cli article.md --doi 10.1515/jdh-2025-0002 --url https://journalofdigitalhistory.org/en/article/BHmHNQKJaSWT
```

## What jdh-cli supplies

A plain JDH article repo is enough. In `_improved/`, jdh-cli adds:

- the bundled `meta-jdh.yml` (licence, PDF export), unless the repo has its own
- the QR code and fingerprint images: from `--qr-code` / `--fingerprint`, else the repo's own `generated/qr.png` / `fingerprint.png`, else clearly marked placeholders (with a warning, since a real article needs the real images)
- `myst.yml` with authors, affiliations, DOI, URL and GitHub link
- the MyST plugins for hermeneutics blocks, narrative code, JDH tables, dialogue and lists
- `references.bib` from the notebook's citation metadata — `citation-manager` items or cite2c's `metadata.cite2c.citations` — plus any `.bib` files in the article repo (e.g. `direct.bib`)
- a `.gitignore`, so the article repo stays clean

### The Typst template

[`jdh-typst-template`](https://github.com/curvenote/jdh-typst-template) is a separate repo; jdh-cli doesn't bundle it. `jdh-cli build` uses it in one of two ways:

| `--template` | Where the template comes from | Fonts (`TYPST_FONT_PATHS`) |
| --- | --- | --- |
| omitted | `../jdh-typst-template` next to the jdh-cli checkout | `<template>/fonts/fira_code` |
| a path | that folder (absolute, or relative to the workdir) | `<template>/fonts/fira_code` |
| a zip URL | downloaded by MyST into `_improved/_build/templates/typst/<sha256 of URL>/` and cached | that folder's `fonts/fira_code` |

```bash
jdh-cli build                                          # sibling checkout
jdh-cli build --template /path/to/jdh-typst-template   # another checkout
jdh-cli build --template https://github.com/curvenote/jdh-typst-template/archive/refs/tags/v0.1.0.zip   # a release
```

**From a release (zip URL).** A GitHub release or tag archive gives a pinned template with no checkout. jdh-cli handles the two things MyST needs for this:

- it sets the export's `format: typst` and runs `myst build --typst` (with `format: pdf` and a URL, MyST assumes a LaTeX template and fails)
- it sets `TYPST_FONT_PATHS` to where MyST will unpack the zip; the folder name is the SHA-256 of the URL, so the path is known before the download. MyST itself never passes font paths to Typst, so without this Fira Code is missing

The first build needs network access; later builds reuse the cached copy. `jdh-cli clean` removes it.

**Either way**, every `exports[].template` in `_improved/`'s config is rewritten to the chosen template, so article repos never reference it. A missing local template fails the build with `Typst template not found`. A checkout isn't pinned (jdh-cli uses whatever is checked out), and the bundled MyST plugins emit markup that the template's `jdh.typ` renders, so keep the two in step; a release URL avoids that drift.

**References.** Any `.bib` in the article repo is used alongside the notebook's citation metadata. When both describe the same work (same DOI, else same title and year), the repo's `.bib` entry wins. A citation whose plugin mapping was lost is recovered from the Zotero key in its link; one that can't be found anywhere is kept as its visible text, with a warning.

Both notebook citation formats are read. `citation-manager` keeps its items under `metadata['citation-manager']` and writes `<cite id="…">(Author, 2003)</cite>`; **cite2c** keeps them under `metadata.cite2c.citations` and writes an empty `<cite data-cite="1787664/QEP4R77C"></cite>`, with the item id in the attribute and nothing to fall back on. cite2c's `{year, month, day}` dates are converted to CSL `date-parts` on the way in. A cite2c marker whose id is in no bibliography is left in the markdown rather than deleted, so an empty `()` can't hide it.

**One pair of parentheses.** Authors wrap citations in their own brackets, which would print as `((Author, 2023))`. A pair holding *nothing but* citations, page locators and short connectives is lifted whole into one MyST citation; anything longer is left alone:

| The author wrote | The PDF prints |
|---|---|
| `(<cite/>)` | `(Milligan, 2019)` |
| `(<cite/> p. 203)` — comma optional | `(Milligan, 2019, p. 203)` |
| `(<cite/>, <cite/>)` | `(Crane, 2018; Mold et al., 2019)` |
| `(e.g. <cite/>, <cite/>)` | `(e.g. Crane, 2018; Mold et al., 2019)` |
| `(<cite/>, 1085; <cite/>)` | `(Bialasiewicz & Minca, 2010, 1085; Faro, 2005)` |
| `(as argued <cite/> and later)` | left as the author's own parentheses |

A locator must open with a page marker, a number or a roman numeral, so prose isn't mistaken for one. `and` between two keys becomes `;`: MyST reads only `;` there, and Typst fails the whole document on the label it otherwise looks for.

Files the article repo provides take precedence. With `jdh-cli init`, edits to the repo's `meta-jdh.yml` are used. From the repo's `myst.yml`, only `project.id` is kept today; keeping other edits is planned.

## Design rules

- **The article repo is the input.** jdh-cli works from `article.md`, `article.ipynb` and other files in the article folder. Content a notebook can't provide as data (e.g. an interactive chart with no image output) becomes a placeholder linking to the online article; it isn't rendered or fetched.
- **No Python dependencies** in the processing chain.
- Network lookups: DOI from the JDH API (`--doi` overrides; an approved exception to the first rule). Under review against the first rule: ROR affiliations (`--no-ror-lookup` disables), ORCID (`--orcid-lookup`, off by default).

## Pipeline

`jdh-cli article.md --list-steps` prints the 18 steps: prepare workdir, init `myst.yml`, cell numbers, citations, citation keys, front matter, ROR affiliations, document parts, hidden cells, anchors, figures (including video and audio), notebook tables, table regions, dialogues, hermeneutics blocks, images from untagged code cells (including the cover), GitHub link, and the JDH article metadata (DOI, URL, date, licence, issue). Figures and tables read `article.ipynb`: figure images and dataframe tables that exist only as notebook output end up in the PDF.

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

---

<p align="center">
  <a href="https://curvenote.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/curvenote-dark.svg">
      <img src=".github/assets/curvenote-light.svg" alt="Curvenote" height="26">
    </picture>
  </a>
</p>

<p align="center">
  Built by <a href="https://curvenote.com">Curvenote</a> for the
  <a href="https://journalofdigitalhistory.org">Journal of Digital History</a><br>
  <sub><a href="https://www.c2dh.uni.lu">Luxembourg Centre for Contemporary and Digital History (C2DH)</a>, University of Luxembourg</sub>
</p>
