import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Command } from 'commander';
import { CliError } from '../cli/errors.js';
import { fileExists } from '../engine/context.js';
import { DEFAULT_WORKDIR, resolveProjectRoot, resolveWorkdirAbs } from '../engine/paths.js';
import { resolveProjectConfigPath } from '../steps/shared/myst-config.js';

const DEFAULT_TEMPLATE = '../../jdh-typst-template';

export function addBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build PDF from the pipeline workdir via myst build --pdf')
    .option('--workdir <path>', 'Pipeline workdir', DEFAULT_WORKDIR)
    .option('--project-root <path>', 'Article repo root', process.cwd())
    .option(
      '--template <path>',
      'JDH Typst template path (relative to workdir unless absolute)',
      DEFAULT_TEMPLATE,
    )
    .addHelpText(
      'after',
      `
Examples:
  $ jdh-cli build
  $ jdh-cli build --project-root ./article --workdir _improved
  $ jdh-cli build --template ../../jdh-typst-template
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

      const templateAbs = path.isAbsolute(opts.template)
        ? opts.template
        : path.resolve(workdirAbs, opts.template);

      if (!fileExists(templateAbs)) {
        throw new CliError(`Typst template not found: ${templateAbs}`);
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
    });
}
