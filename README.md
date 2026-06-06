## jdh-cli

Convert and improve Jupytext-exported articles into a MyST-ready project (`myst.yml`, `article.md`, assets).

**All pipeline logic lives in this package** (`src/steps/`).

### Commands

| Command | Description |
| --- | --- |
| `jdh-cli init` | Create `myst.yml` and copy bundled `meta-jdh.yml` for a new article repo |
| `jdh-cli <file.md>` | Run the 11-step jupytext conversion pipeline (deploys bundled MyST plugins; see [docs/plugins.md](docs/plugins.md)) |
| `jdh-cli clean` | Remove the pipeline workdir and legacy `.bak` files |
| `jdh-cli build` | Build PDF from the workdir via `myst build --pdf` |

### Jupytext ruleset

| Command | Ruleset | Folders |
| --- | --- | --- |
| `jdh-cli <file.md>` | `jupytext` | `steps/common/` + `steps/jupytext/` |

### Source layout

```
jdh-cli/src/
  commands/              convert, init, clean, build
  engine/                runner, workdir, step context
  init/                  bundled meta-jdh.yml + MyST plugins
  templates/             shipped assets (meta-jdh.yml, plugins/*.mjs)
  steps/                 self-contained pipeline steps
    common/              shared steps (one file each)
    jupytext/            notebook / region steps
    shared/              when guards, myst-config helpers
```

### Development

```bash
cd jdh-cli
bun install
bun run compile
bun run build              # one-off production build
bun run dev:build          # watch dist/jdh-cli.cjs (+ templates) while editing src/
bun run dev                # bun link + dev:build
bun test
bun test test/build-integration.test.ts   # requires myst CLI + ../jdh-typst-template
bun src/index.ts --help
bun src/index.ts ../BHmHNQKJaSWT/article.md --list-steps --project-root ../BHmHNQKJaSWT
```

### Article repo integration

In the article repo `package.json`:

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

Prerequisites:

- Build jdh-cli first: `cd jdh-cli && bun run build`
- Install in article repo: `npm install`
- `myst` CLI for PDF builds
- Sibling `jdh-typst-template` at `../../jdh-typst-template` (relative to `_improved/`)

For Word (`.docx`) conversion, use the separate **doc-convert** package.
