## jdh-cli

Convert and improve Jupytext-exported articles into a MyST-ready project (`myst.yml`, `article.md`, assets).

**All pipeline logic lives in this package** (`src/steps/`). The `BHmHNQKJaSWT/script/*.ts` files remain for reference and manual testing but are no longer invoked by the CLI.

### Entry point

| Command | Ruleset | Folders |
| --- | --- | --- |
| `jdh-cli <file.md>` | `jupytext` | `steps/common/` + `steps/jupytext/` |

The 11-step jupytext pipeline supports custom steps and directives for the JDH article-repo layout.

### Source layout

```
jdh-cli/src/
  commands/              CLI (convert)
  engine/                runner, workdir, step context
  rulesets/              jupytext ruleset
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
bun src/index.ts --help
bun src/index.ts ../BHmHNQKJaSWT/article.md --list-steps --project-root ../BHmHNQKJaSWT
bun run build
```

### Article repo

```bash
cd ../BHmHNQKJaSWT
npm run improve   # jdh-cli article.md
```

For Word (`.docx`) conversion, use the separate **doc-convert** package.
