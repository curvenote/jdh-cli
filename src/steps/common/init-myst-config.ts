import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';

const DEFAULT_CONFIG = 'myst.yml';
const LEGACY_CONFIG = 'curvenote.yml';
const METADATA_FILE = 'metadata.yml';

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readProjectIdFromFile(configPath: string): string | null {
  if (!fileExists(configPath)) return null;
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  const m = content.match(/^\s*id:\s*([^\s#]+)\s*$/m);
  return m ? m[1] : null;
}

function readExistingProjectId(configPath: string): string | null {
  const primary = readProjectIdFromFile(configPath);
  if (primary) return primary;
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  if (base === LEGACY_CONFIG) return null;
  const legacyPath = path.join(dir, LEGACY_CONFIG);
  if (legacyPath === configPath) return null;
  return readProjectIdFromFile(legacyPath);
}

function buildScaffold(projectId: string, extendMetadata: boolean): string {
  const extendsBlock = extendMetadata
    ? ['extends:', `  - ${METADATA_FILE}`, '']
    : [];

  return [
    '# See docs at: https://mystmd.org/guide/frontmatter',
    'version: 1',
    ...extendsBlock,
    'project:',
    `  id: ${projectId}`,
    '  open_access: true',
    '  license: CC-BY-NC-ND-4.0',
    '  plugins:',
    '    - plugins/hermeneutics.mjs',
    '  # To autogenerate a Table of Contents, run "myst init --write-toc"',
    '  toc:',
    '    - file: article.md',
    '  exports:',
    '    - format: pdf',
    '      template: ../../jdh-typst-template',
    '      article: article.md',
    '      output: article.pdf',
    '      qr_code: ./generated/qr.png',
    '      fingerprint: ./generated/fingerprint.png',
    'site:',
    '  template: book-theme',
    '  # options:',
    '  #   favicon: favicon.ico',
    '  #   logo: site_logo.png',
    '',
  ].join('\n');
}

async function initMystConfig(options: {
  configPath: string;
  forcedId?: string;
  dryRun: boolean;
  cwd: string;
}): Promise<void> {
  const configPath = path.resolve(options.cwd, options.configPath || DEFAULT_CONFIG);
  const metadataInWorkdir = path.join(options.cwd, METADATA_FILE);
  const extendMetadata = fileExists(metadataInWorkdir);

  const existedBefore = fileExists(configPath);
  const existingId = readExistingProjectId(configPath);

  let projectId: string;
  let idSource: 'forced' | 'preserved' | 'generated';
  if (options.forcedId) {
    projectId = options.forcedId;
    idSource = 'forced';
  } else if (existingId) {
    projectId = existingId;
    idSource = 'preserved';
  } else {
    projectId = crypto.randomUUID();
    idSource = 'generated';
  }

  const scaffold = buildScaffold(projectId, extendMetadata);

  if (options.dryRun) {
    process.stdout.write(
      `[dry-run] would write ${configPath} (${existedBefore ? 'overwrite' : 'create'}, id ${idSource}: ${projectId})\n`,
    );
    process.stdout.write(
      extendMetadata
        ? `[dry-run] extends: ${METADATA_FILE} (copied alongside myst.yml in workdir)\n`
        : `[dry-run] no ${METADATA_FILE} in workdir; extends omitted\n`,
    );
    process.stdout.write(scaffold);
    return;
  }

  fs.writeFileSync(configPath, scaffold);
  process.stdout.write(
    `${existedBefore ? 'Overwrote' : 'Created'} ${configPath} with canonical scaffold (id ${idSource}: ${projectId}).\n`,
  );
  if (extendMetadata) {
    process.stdout.write(`  extends: ${METADATA_FILE}\n`);
  }
}

/**
 * Write a canonical JDH `myst.yml` scaffold, preserving an existing project id
 * and extending `metadata.yml` when present in the workdir.
 */
export const initMystConfigStep: PipelineStep = {
  id: 'initMystConfig',
  label: 'Init myst.yml from canonical scaffold',
  inputs: ['myst', 'project'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await initMystConfig({
      configPath: 'myst.yml',
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
