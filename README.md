## jdh-cli

Convert and improve Jupytext-exported articles into a MyST-ready project (`myst.yml`, `article.md`, assets).

**Documentation:** [docs/](docs/) — MyST site with CLI usage, pipeline, and plugin/directive reference. Build with `cd docs && myst build --html`.

**All pipeline logic lives in this package** (`src/steps/`).

### Commands

| Command | Description |
| --- | --- |
| `jdh-cli init` | Optional: write `myst.yml` and `meta-jdh.yml` into an article repo to customise them |
| `jdh-cli <file.md>` | Run the 12-step jupytext conversion pipeline (deploys bundled MyST plugins; see [docs](docs/)) |
| `jdh-cli clean` | Remove the pipeline workdir and legacy `.bak` files |
| `jdh-cli build` | Build PDF from the workdir via `myst build --pdf` |

### Jupytext ruleset

| Command | Ruleset | Folders |
| --- | --- | --- |
| `jdh-cli <file.md>` | `jupytext` | `steps/common/` + `steps/jupytext/` |

### Source layout

```
jdh-cli/
  src/
    cli/                 error handling
    commands/            convert, init, clean, build
    engine/              runner, workdir, step context
    init/                bundled meta-jdh.yml + MyST plugins
    rulesets/            step order for each ruleset (jupytext)
    steps/               self-contained pipeline steps
      common/            shared steps (one file each)
      jupytext/          notebook / region steps
      shared/            when guards, myst-config helpers
  templates/             shipped assets (meta-jdh.yml, plugins/*.mjs, placeholder generated/*.png)
```

### Development

```bash
cd jdh-cli
bun install
bun run compile
bun run lint
bun run build              # one-off production build
bun run dev:build          # watch dist/jdh-cli.cjs (+ templates) while editing src/
bun run dev                # bun link + dev:build
bun test
bun test test/build-integration.test.ts   # requires myst CLI + ../jdh-typst-template + ../art-unpub/BHmHNQKJaSWT
bun src/index.ts --help
bun src/index.ts ../art-unpub/BHmHNQKJaSWT/article.md --list-steps --project-root ../art-unpub/BHmHNQKJaSWT
```

### Using jdh-cli on an article repo

Article repos need no setup: a plain JDH repo (`article.md` + `article.ipynb`, as published by the journal) is enough. jdh-cli supplies everything else in the workdir:

- the bundled `meta-jdh.yml` (license, PDF export), unless the repo has its own
- placeholder `generated/qr.png` and `generated/fingerprint.png`, unless the repo has its own
- the MyST plugins, `myst.yml`, DOI and website
- a `.gitignore` inside `_improved/`, so the article repo stays clean

Put `jdh-cli` on your PATH once (`cd jdh-cli && bun run build && bun link`), then from any article repo:

```bash
jdh-cli article.md        # convert into _improved/
jdh-cli build             # PDF → _improved/article.pdf
jdh-cli clean             # remove _improved/
```

Prerequisites:

- `myst` CLI for PDF builds
- `jdh-typst-template` checked out next to `jdh-cli` (or pass `jdh-cli build --template <path>`)
