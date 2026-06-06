import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from '../engine/context.js';
import { resolveGithubFromGit } from '../steps/shared/git.js';
import { META_JDH_FILE, readBundledMetaJdhTemplate } from './bundled-assets.js';

export const MYST_CONFIG = 'myst.yml';
export const LEGACY_CONFIG = 'curvenote.yml';

export const SPA_PREVIEW_TEMPLATE =
  'https://github.com/curvenote-themes/spa-preview/archive/refs/heads/main.zip';

export type ExistingConfig = typeof MYST_CONFIG | typeof LEGACY_CONFIG;

/** Return which project config file already exists in `dir`, if any. */
export function findExistingProjectConfig(dir: string): ExistingConfig | null {
  if (fileExists(path.join(dir, MYST_CONFIG))) return MYST_CONFIG;
  if (fileExists(path.join(dir, LEGACY_CONFIG))) return LEGACY_CONFIG;
  return null;
}

export function buildInitMystYaml(options: {
  projectId: string;
  github?: string;
  siteTemplate?: string;
  extendMetaJdh?: boolean;
}): string {
  const extendsBlock =
    options.extendMetaJdh !== false
      ? ['extends:', `  - ${META_JDH_FILE}`, '']
      : [];

  const lines = [
    '# See docs at: https://mystmd.org/guide/frontmatter',
    'version: 1',
    ...extendsBlock,
    'project:',
    `  id: ${options.projectId}`,
  ];
  if (options.github) {
    lines.push(`  github: ${options.github}`);
  }
  lines.push('site:');
  lines.push(`  template: ${options.siteTemplate ?? SPA_PREVIEW_TEMPLATE}`);
  lines.push('');
  return lines.join('\n');
}

export type InitProjectResult =
  | { status: 'already-initialized'; existing: ExistingConfig; dir: string }
  | {
      status: 'created';
      mystPath: string;
      metaJdhPath: string;
      projectId: string;
      github: string | null;
      dryRun: boolean;
    };

/** Create `myst.yml` and copy bundled `meta-jdh.yml` when no project config exists yet. */
export function initProjectConfig(dir: string, dryRun = false): InitProjectResult {
  const projectRoot = path.resolve(dir);
  const existing = findExistingProjectConfig(projectRoot);
  if (existing) {
    return { status: 'already-initialized', existing, dir: projectRoot };
  }

  const projectId = crypto.randomUUID();
  const github = resolveGithubFromGit(projectRoot);
  const mystContent = buildInitMystYaml({ projectId, github: github ?? undefined });
  const metaJdhContent = readBundledMetaJdhTemplate();
  const mystPath = path.join(projectRoot, MYST_CONFIG);
  const metaJdhPath = path.join(projectRoot, META_JDH_FILE);

  if (!dryRun) {
    fs.writeFileSync(mystPath, mystContent);
    fs.writeFileSync(metaJdhPath, metaJdhContent);
  }

  return {
    status: 'created',
    mystPath,
    metaJdhPath,
    projectId,
    github,
    dryRun,
  };
}
