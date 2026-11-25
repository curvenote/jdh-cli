import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/** True for a template given as a URL (e.g. a GitHub release zip) rather than a local path. */
export function isTemplateUrl(template: string): boolean {
  return /^https?:\/\//.test(template);
}

/**
 * Fonts folder of a URL template once myst has downloaded it. myst caches the zip
 * under `_build/templates/typst/<sha256 of the URL>/`, so the path is known before
 * the download; Typst only reads TYPST_FONT_PATHS when it compiles.
 */
export function urlTemplateFontPath(workdirAbs: string, url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return path.join(workdirAbs, '_build', 'templates', 'typst', hash, 'fonts', 'fira_code');
}

/**
 * Point every `exports[].template` in a workdir config at `templateAbs`, so the
 * article repo never has to know where the template lives. Returns true if changed.
 */
export function pointExportsAtTemplate(configPath: string, templateAbs: string): boolean {
  // myst only treats a URL template as Typst when the export says `format: typst`.
  const url = isTemplateUrl(templateAbs);
  if (!fileExists(configPath)) return false;
  return updateYamlFile(configPath, (doc) => {
    const exports = doc.getIn(['project', 'exports']);
    if (!isSeq(exports)) return;
    exports.items.forEach((_item, i) => {
      if (doc.hasIn(['project', 'exports', i, 'template'])) {
        doc.setIn(['project', 'exports', i, 'template'], templateAbs);
        if (url) doc.setIn(['project', 'exports', i, 'format'], 'typst');
      }
    });
  });
}

/**
 * Template options written onto every templated export.
 *
 * `preprint` is written on every build, including `false`, and `csl` is removed when
 * no file is given, so dropping either flag undoes what an earlier build left in the
 * config (JDH-077, JDH-078).
 */
export function templateExportOptions(
  placement: string,
  preprint: boolean,
  preprintText?: string,
  cslAbs?: string,
): Map<string, string | boolean | null> {
  if (!['none', 'auto'].includes(placement)) {
    throw new CliError(`--figure-placement must be "none" or "auto" (got "${placement}")`);
  }
  if (preprintText && !preprint)
    throw new CliError('--preprint-text only applies with --preprint.');
  const options = new Map<string, string | boolean | null>([
    ['figure_placement', placement],
    ['preprint', preprint],
    // null removes the option, so dropping --csl goes back to the built-in APA.
    ['csl', cslAbs ?? null],
  ]);
  if (preprint && preprintText) options.set('preprint_text', preprintText);
  return options;
}

export function addBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build PDF from the pipeline workdir via myst build --pdf')
    .option('--workdir <path>', 'Pipeline workdir', DEFAULT_WORKDIR)
    .option('--project-root <path>', 'Article repo root', process.cwd())
    .option(
      '--template <path>',
      'JDH Typst template: a path (relative to the workdir unless absolute) or a zip URL such as a GitHub release (default: jdh-typst-template next to jdh-cli)',
    )
    .option(
      '--figure-placement <mode>',
      'Figures: "none" keeps each where it is in the text; "auto" floats them to the top or bottom of a page (JDH-049)',
      'none',
    )
    .option('--preprint', 'Watermark every page: the article is not published yet (JDH-077)')
    .option('--preprint-text <text>', 'Wording of the preprint watermark (default "PREPRINT")')
    .option(
      '--csl <path>',
      "A CSL style file for citations and references, instead of Typst's built-in APA 7th (JDH-078)",
    )
    .addHelpText(
      'after',
      `
Examples:
  $ jdh-cli build
  $ jdh-cli build --project-root ./article --workdir _improved
  $ jdh-cli build --template /path/to/jdh-typst-template
  $ jdh-cli build --template https://github.com/curvenote/jdh-typst-template/archive/refs/tags/v0.1.0.zip
  $ jdh-cli build --figure-placement auto
  $ jdh-cli build --preprint
  $ jdh-cli build --preprint --preprint-text "ACCEPTED MANUSCRIPT"
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

      const templateIsUrl = !!opts.template && isTemplateUrl(opts.template);
      const templateAbs = !opts.template
        ? defaultTemplatePath()
        : templateIsUrl || path.isAbsolute(opts.template)
          ? opts.template
          : path.resolve(workdirAbs, opts.template);

      if (!templateIsUrl && !fileExists(templateAbs)) {
        throw new CliError(`Typst template not found: ${templateAbs}`);
      }

      // MyST and Typst are not bundled: check them first, with install guidance (JDH-051).
      const toolchain = checkToolchain();
      if (toolchain.errors.length) throw new CliError(toolchain.errors.join('\n\n'));
      for (const warning of toolchain.warnings) console.warn(`Warning: ${warning}\n`);

      const placement = String(opts.figurePlacement);
      const preprint = opts.preprint === true;
      // MyST copies a `type: file` option into the build's `files/` folder and
      // rewrites the path, so an absolute path here is enough.
      let cslAbs: string | undefined;
      if (opts.csl) {
        cslAbs = path.resolve(String(opts.csl));
        if (!fileExists(cslAbs)) throw new CliError(`CSL file not found: ${cslAbs}`);
      }
      const templateOptions = templateExportOptions(placement, preprint, opts.preprintText, cslAbs);
      for (const config of [META_JDH_FILE, path.basename(mystYml)]) {
        pointExportsAtTemplate(path.join(workdirAbs, config), templateAbs);
        pointExportsAtSidebarImages(path.join(workdirAbs, config), templateOptions);
      }

      const fontPath = templateIsUrl
        ? urlTemplateFontPath(workdirAbs, templateAbs)
        : path.join(templateAbs, 'fonts', 'fira_code');
      const env = {
        ...process.env,
        TYPST_FONT_PATHS: fontPath,
      };

      // A URL template's exports are `format: typst`, which `--pdf` skips.
      const buildFlag = templateIsUrl ? '--typst' : '--pdf';
      const cmd = `myst build ${buildFlag}`;
      console.log(`Toolchain: ${toolchain.summary}`);
      console.log(`Workdir:  ${workdirAbs}`);
      console.log(`Template: ${templateAbs}`);
      console.log(`Fonts:    ${fontPath}`);
      console.log(
        `Figures:  ${placement === 'auto' ? 'float to the top or bottom of a page' : 'stay where they are in the text'}`,
      );
      if (preprint)
        console.log(`Preprint: every page watermarked "${opts.preprintText ?? 'PREPRINT'}"`);
      console.log(`Citations: ${cslAbs ?? "Typst's built-in APA 7th"}`);
      console.log(`$ cd ${workdirAbs} && TYPST_FONT_PATHS=${fontPath} ${cmd}\n`);

      const pdfPath = path.join(workdirAbs, 'article.pdf');
      const startedAt = Date.now();
      const res = spawnSync('myst', ['build', buildFlag], {
        cwd: workdirAbs,
        stdio: 'inherit',
        env,
      });

      // A missing `myst` is already caught by the toolchain check above.
      if (res.error) throw new CliError(res.error.message);

      const code = typeof res.status === 'number' ? res.status : 1;
      if (code !== 0) {
        throw new CliError(`myst build failed with exit code ${code}`);
      }
      // myst can exit 0 when Typst fails, so check the PDF was actually written.
      if (!fileExists(pdfPath) || fs.statSync(pdfPath).mtimeMs < startedAt) {
        throw new CliError(
          `myst build finished but ${pdfPath} was not written; see the Typst errors above.`,
        );
      }
      console.log(`\nPDF: ${pdfPath}`);
    });
}
