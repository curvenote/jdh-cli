import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { isSeq } from 'yaml';
import { CliError } from '../cli/errors.js';
import { fileExists } from '../engine/context.js';
import { DEFAULT_WORKDIR, resolveProjectRoot, resolveWorkdirAbs } from '../engine/paths.js';
import { pointExportsAtSidebarImages } from '../engine/sidebar-images.js';
import { checkToolchain } from '../engine/toolchain.js';
import { META_JDH_FILE, resolveJdhCliRoot } from '../init/bundled-assets.js';
import { resolveProjectConfigPath } from '../steps/shared/myst-config.js';
import { updateYamlFile } from '../steps/shared/yaml-doc.js';

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
  return updateYamlFile(configPath, (doc) => {
    const exports = doc.getIn(['project', 'exports']);
    if (!isSeq(exports)) return;
    exports.items.forEach((_item, i) => {
      if (doc.hasIn(['project', 'exports', i, 'template'])) {
        doc.setIn(['project', 'exports', i, 'template'], templateAbs);
      }
    });
  });
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
    .option(
      '--figure-placement <mode>',
      'Figures: "none" keeps each where it is in the text; "auto" floats them to the top or bottom of a page (JDH-049)',
      'none',
    )
    .addHelpText(
      'after',
      `
Examples:
  $ jdh-cli build
  $ jdh-cli build --project-root ./article --workdir _improved
  $ jdh-cli build --template /path/to/jdh-typst-template
  $ jdh-cli build --figure-placement auto
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

      // MyST and Typst are not bundled: check them first, with install guidance (JDH-051).
      const toolchain = checkToolchain();
      if (toolchain.errors.length) throw new CliError(toolchain.errors.join('\n\n'));
      for (const warning of toolchain.warnings) console.warn(`Warning: ${warning}\n`);

      const placement = String(opts.figurePlacement);
      if (!['none', 'auto'].includes(placement)) {
        throw new CliError(`--figure-placement must be "none" or "auto" (got "${placement}")`);
      }
      for (const config of [META_JDH_FILE, path.basename(mystYml)]) {
        pointExportsAtTemplate(path.join(workdirAbs, config), templateAbs);
        pointExportsAtSidebarImages(path.join(workdirAbs, config), new Map([['figure_placement', placement]]));
      }

      const fontPath = path.join(templateAbs, 'fonts', 'fira_code');
      const env = {
        ...process.env,
        TYPST_FONT_PATHS: fontPath,
      };

      const cmd = `myst build --pdf`;
      console.log(`Toolchain: ${toolchain.summary}`);
      console.log(`Workdir:  ${workdirAbs}`);
      console.log(`Template: ${templateAbs}`);
      console.log(`Fonts:    ${fontPath}`);
      console.log(`Figures:  ${placement === 'auto' ? 'float to the top or bottom of a page' : 'stay where they are in the text'}`);
      console.log(`$ cd ${workdirAbs} && TYPST_FONT_PATHS=${fontPath} ${cmd}\n`);

      const pdfPath = path.join(workdirAbs, 'article.pdf');
      const startedAt = Date.now();
      const res = spawnSync('myst', ['build', '--pdf'], {
        cwd: workdirAbs,
        stdio: 'inherit',
        env,
      });

      if (res.error) throw new CliError(res.error.message);

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
