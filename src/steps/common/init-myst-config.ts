import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { META_JDH_FILE } from '../../init/bundled-assets.js';
import { listBundledPluginRelPaths } from '../../init/bundled-plugins.js';
import { readYamlDocument, toYaml, updateYamlFile } from '../shared/yaml-doc.js';
import { isSeq, type Document } from 'yaml';

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
  try {
    const id = readYamlDocument(configPath).getIn(['project', 'id']);
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
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

export const DEFAULT_SITE_TEMPLATE = 'book-theme';

function buildScaffold(projectId: string, extendMetadata: boolean): string {
  return toYaml(
    {
      version: 1,
      ...(extendMetadata ? { extends: [META_JDH_FILE] } : {}),
      project: {
        id: projectId,
        open_access: true,
        plugins: listBundledPluginRelPaths(),
        toc: [{ file: 'article.md' }],
      },
      site: { template: DEFAULT_SITE_TEMPLATE },
    },
    'See docs at: https://mystmd.org/guide/frontmatter',
  );
}

/** Fill in what the pipeline needs on a hand-written myst.yml, keeping everything else. */
export function completeConfig(doc: Document, projectId: string, extendMetadata: boolean, added: string[]): void {
  if (!doc.has('version')) doc.set('version', 1);
  if (extendMetadata) {
    const ext = doc.get('extends');
    const list = isSeq(ext) ? (ext.toJSON() as string[]) : typeof ext === 'string' ? [ext] : [];
    if (!list.includes(META_JDH_FILE)) {
      doc.set('extends', [...list, META_JDH_FILE]);
      added.push(`extends ${META_JDH_FILE}`);
    }
  }
  if (doc.getIn(['project', 'id']) !== projectId) doc.setIn(['project', 'id'], projectId);
  const plugins = doc.getIn(['project', 'plugins']);
  const current = isSeq(plugins) ? (plugins.toJSON() as string[]) : [];
  const missing = listBundledPluginRelPaths().filter((p) => !current.includes(p));
  if (missing.length) {
    doc.setIn(['project', 'plugins'], [...current, ...missing]);
    added.push(`${missing.length} bundled plugin(s)`);
  }
  if (!doc.hasIn(['project', 'toc'])) {
    doc.setIn(['project', 'toc'], [{ file: 'article.md' }]);
    added.push('toc');
  }
  if (!doc.hasIn(['site', 'template'])) {
    doc.setIn(['site', 'template'], DEFAULT_SITE_TEMPLATE);
    added.push(`site.template ${DEFAULT_SITE_TEMPLATE}`);
  }
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

  // The article repo's own myst.yml (copied into the workdir) is the base:
  // hand edits are kept and only what the pipeline needs is filled in.
  if (existedBefore) {
    const added: string[] = [];
    updateYamlFile(configPath, (doc) => completeConfig(doc, projectId, extendMetadata, added), options.dryRun);
    process.stdout.write(
      `${options.dryRun ? '[dry-run] would use' : 'Using'} the repo's myst.yml as the base (id ${idSource}: ${projectId})` +
        (added.length ? `; added ${added.join(', ')}` : '') +
        '.\n',
    );
    return;
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
 * Write the workdir `myst.yml`: the article repo's own file (copied in by
 * prepareWorkdir) completed with what the pipeline needs, else a canonical
 * scaffold. Preserves an existing project id; extends `meta-jdh.yml` when present.
 */
export const initMystConfigStep: PipelineStep = {
  id: 'initMystConfig',
  label: 'Init myst.yml (repo file as base, else canonical scaffold)',
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
