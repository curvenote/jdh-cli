import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { META_JDH_FILE } from '../../init/bundled-assets.js';
import { listBundledPluginRelPaths } from '../../init/bundled-plugins.js';

const DEFAULT_CONFIG = 'myst.yml';
const LEGACY_CONFIG = 'curvenote.yml';

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
    ? ['extends:', `  - ${META_JDH_FILE}`, '']
    : [];

  const pluginLines = listBundledPluginRelPaths().flatMap((relPath) => [`    - ${relPath}`]);

  return [
    '# See docs at: https://mystmd.org/guide/frontmatter',
    'version: 1',
    ...extendsBlock,
    'project:',
    `  id: ${projectId}`,
    '  open_access: true',
    '  plugins:',
    ...pluginLines,
    '  # To autogenerate a Table of Contents, run "myst init --write-toc"',
    '  toc:',
    '    - file: article.md',
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
  const metadataInWorkdir = path.join(options.cwd, META_JDH_FILE);
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
        ? `[dry-run] extends: ${META_JDH_FILE} (copied alongside myst.yml in workdir)\n`
        : `[dry-run] no ${META_JDH_FILE} in workdir; extends omitted\n`,
    );
    process.stdout.write(scaffold);
    return;
  }

  fs.writeFileSync(configPath, scaffold);
  process.stdout.write(
    `${existedBefore ? 'Overwrote' : 'Created'} ${configPath} with canonical scaffold (id ${idSource}: ${projectId}).\n`,
  );
  if (extendMetadata) {
    process.stdout.write(`  extends: ${META_JDH_FILE}\n`);
  }
}

/**
 * Write a canonical JDH `myst.yml` scaffold, preserving an existing project id
 * and extending `meta-jdh.yml` when present in the workdir.
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
