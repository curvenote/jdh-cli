import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from '../engine/context.js';
import { resolveGithubFromGit } from '../steps/shared/git.js';
import { toYaml } from '../steps/shared/yaml-doc.js';
import { META_JDH_FILE, readBundledMetaJdhTemplate } from './bundled-assets.js';

export const MYST_CONFIG = 'myst.yml';
export const LEGACY_CONFIG = 'curvenote.yml';

/** Same site template the pipeline uses (the PDF doesn't depend on it). */
export const DEFAULT_SITE_TEMPLATE = 'book-theme';

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
  return toYaml(
    {
      version: 1,
      ...(options.extendMetaJdh !== false ? { extends: [META_JDH_FILE] } : {}),
      project: {
        id: options.projectId,
        ...(options.github ? { github: options.github } : {}),
      },
      site: { template: options.siteTemplate ?? DEFAULT_SITE_TEMPLATE },
    },
    'See docs at: https://mystmd.org/guide/frontmatter',
  );
}

export type InitProjectResult =
  | { status: 'already-initialized'; existing: ExistingConfig; dir: string }
  | {
      status: 'created';
      mystPath: string;
      metaJdhPath: string;
      projectId: string;
      github: string | null;
    };

/** Create `myst.yml` and copy bundled `meta-jdh.yml` when no project config exists yet. */
export function initProjectConfig(dir: string): InitProjectResult {
  const projectRoot = path.resolve(dir);
  const existing = findExistingProjectConfig(projectRoot);
  if (existing) {
    return { status: 'already-initialized', existing, dir: projectRoot };
  }

  fs.mkdirSync(projectRoot, { recursive: true });

  const projectId = crypto.randomUUID();
  const github = resolveGithubFromGit(projectRoot);
  const mystContent = buildInitMystYaml({ projectId, github: github ?? undefined });
  const metaJdhContent = readBundledMetaJdhTemplate();
  const mystPath = path.join(projectRoot, MYST_CONFIG);
  const metaJdhPath = path.join(projectRoot, META_JDH_FILE);

  fs.writeFileSync(mystPath, mystContent);
  fs.writeFileSync(metaJdhPath, metaJdhContent);

  return {
    status: 'created',
    mystPath,
    metaJdhPath,
    projectId,
    github,
  };
}
