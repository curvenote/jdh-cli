import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { CliError } from '../cli/errors.js';
import { fileExists } from '../engine/context.js';
import { DEFAULT_WORKDIR, resolveProjectRoot, resolveWorkdirAbs } from '../engine/paths.js';
import { META_JDH_FILE, resolveJdhCliRoot } from '../init/bundled-assets.js';
import { resolveProjectConfigPath } from '../steps/shared/myst-config.js';

/** Default template: `jdh-typst-template` checked out next to jdh-cli. */
function defaultTemplatePath(): string {
  return path.resolve(resolveJdhCliRoot(), '..', 'jdh-typst-template');
}

/**
 * Point every `exports[].template` in a workdir config at `templateAbs`, so the
 * article repo never has to know where the template lives. Returns true if changed.
 */
export function pointExportsAtTemplate(configPath: string, templateAbs: string): boolean {
  if (!fileExists(configPath)) return false;
  const lines = fs.readFileSync(configPath, 'utf8').split('\n');
  let exportsIndent: number | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    if (/^\s*exports:\s*$/.test(line)) {
      exportsIndent = indent;
      continue;
    }
    if (exportsIndent == null || line.trim() === '') continue;
    if (indent <= exportsIndent && !line.trimStart().startsWith('-')) {
      exportsIndent = null;
      continue;
    }
    const m = line.match(/^(\s*(?:-\s+)?template:\s*).*$/);
    if (m) {
      lines[i] = `${m[1]}${templateAbs}`;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(configPath, lines.join('\n'));
  return changed;
}

export function addBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build PDF from the pipeline workdir via myst build --pdf')
    .option('--workdir <path>', 'Pipeline workdir', DEFAULT_WORKDIR)
    .option('--project-root <path>', 'Article repo root', process.cwd())
    .option(
      '--template <path>',
      'JDH Typst template path, relative to the workdir unless absolute (default: jdh-typst-template next to jdh-cli)',
    )
    .addHelpText(
      'after',
      `
Examples:
  $ jdh-cli build
  $ jdh-cli build --project-root ./article --workdir _improved
  $ jdh-cli build --template /path/to/jdh-typst-template
`,
    )
    .action((opts) => {
      const projectRoot = resolveProjectRoot(opts.projectRoot);

      let workdirAbs: string;
      try {
        workdirAbs = resolveWorkdirAbs(projectRoot, opts.workdir);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }

      if (!fileExists(workdirAbs)) {
        throw new CliError(
          `Workdir not found: ${workdirAbs}\nRun \`jdh-cli article.md\` (or npm run improve) first.`,
        );
      }

      const mystYml = resolveProjectConfigPath(workdirAbs);
      if (!fileExists(mystYml)) {
        throw new CliError(
          `No myst.yml (or curvenote.yml) in ${workdirAbs}\nRun \`jdh-cli article.md\` (or npm run improve) first.`,
        );
      }

      const templateAbs = !opts.template
        ? defaultTemplatePath()
        : path.isAbsolute(opts.template)
          ? opts.template
          : path.resolve(workdirAbs, opts.template);

      if (!fileExists(templateAbs)) {
        throw new CliError(`Typst template not found: ${templateAbs}`);
      }

      for (const config of [META_JDH_FILE, path.basename(mystYml)]) {
        pointExportsAtTemplate(path.join(workdirAbs, config), templateAbs);
      }

      const fontPath = path.join(templateAbs, 'fonts', 'fira_code');
      const env = {
        ...process.env,
        TYPST_FONT_PATHS: fontPath,
      };

      const cmd = `myst build --pdf`;
      console.log(`Workdir:  ${workdirAbs}`);
      console.log(`Template: ${templateAbs}`);
      console.log(`Fonts:    ${fontPath}`);
      console.log(`$ cd ${workdirAbs} && TYPST_FONT_PATHS=${fontPath} ${cmd}\n`);

      const pdfPath = path.join(workdirAbs, 'article.pdf');
      const startedAt = Date.now();
      const res = spawnSync('myst', ['build', '--pdf'], {
        cwd: workdirAbs,
        stdio: 'inherit',
        env,
      });

      if (res.error) {
        throw new CliError(
          res.error.message.includes('ENOENT')
            ? 'myst CLI not found. Install MyST: https://mystmd.org'
            : res.error.message,
        );
      }

      const code = typeof res.status === 'number' ? res.status : 1;
      if (code !== 0) {
        throw new CliError(`myst build failed with exit code ${code}`);
      }
      // myst can exit 0 when Typst fails, so check the PDF was actually written.
      if (!fileExists(pdfPath) || fs.statSync(pdfPath).mtimeMs < startedAt) {
        throw new CliError(`myst build finished but ${pdfPath} was not written; see the Typst errors above.`);
      }
      console.log(`\nPDF: ${pdfPath}`);
    });
}
