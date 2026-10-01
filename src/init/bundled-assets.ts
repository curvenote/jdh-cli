import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists } from '../engine/context.js';

export const META_JDH_FILE = 'meta-jdh.yml';

/** Resolve path to the shipped `meta-jdh.yml` template bundled with jdh-cli. */
export function resolveBundledMetaJdhPath(): string {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
  const candidates: string[] = [];

  if (entry) {
    candidates.push(path.join(path.dirname(entry), META_JDH_FILE));
    candidates.push(path.join(path.dirname(entry), '..', 'templates', META_JDH_FILE));
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // Source layout (`src/init/…` during dev / tests).
  candidates.push(path.join(moduleDir, '..', '..', 'templates', META_JDH_FILE));
  candidates.push(path.join(moduleDir, '..', '..', 'dist', META_JDH_FILE));
  // Shipped bundle (`dist/jdh-cli.cjs` — moduleDir is `dist/`).
  candidates.push(path.join(moduleDir, '..', 'templates', META_JDH_FILE));
  candidates.push(path.join(moduleDir, META_JDH_FILE));

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }

  throw new Error(
    `Bundled ${META_JDH_FILE} template not found. Rebuild jdh-cli: bun run build`,
  );
}

export function readBundledMetaJdhTemplate(): string {
  return fs.readFileSync(resolveBundledMetaJdhPath(), 'utf8');
}

export const GENERATED_DIR = 'generated';

/** Sidebar images the PDF export expects in `generated/` (see bundled meta-jdh.yml). */
export const GENERATED_IMAGES: readonly string[] = ['qr.png', 'fingerprint.png'];

/** Resolve the directory of placeholder `generated/` images bundled with jdh-cli. */
export function resolveBundledGeneratedDir(): string {
  return path.join(path.dirname(resolveBundledMetaJdhPath()), GENERATED_DIR);
}

/** jdh-cli package root (parent of `templates/` or `dist/`). */
export function resolveJdhCliRoot(): string {
  return path.dirname(path.dirname(resolveBundledMetaJdhPath()));
}

/**
 * Fill in what a plain JDH article repo does not carry: the bundled
 * meta-jdh.yml and placeholder sidebar images. Existing files are kept.
 * Returns the number of files deployed.
 */
export function deployBundledDefaults(workdirAbs: string, dryRun: boolean): number {
  const prefix = dryRun ? '[dry-run] ' : '';
  const verb = dryRun ? 'would copy' : 'copy    ';
  let deployed = 0;

  const metaDest = path.join(workdirAbs, META_JDH_FILE);
  if (!fileExists(metaDest)) {
    console.log(`  - ${prefix}${verb} ${META_JDH_FILE}  (bundled default)`);
    if (!dryRun) fs.copyFileSync(resolveBundledMetaJdhPath(), metaDest);
    deployed++;
  }

  const generatedSrc = resolveBundledGeneratedDir();
  for (const name of GENERATED_IMAGES) {
    const dest = path.join(workdirAbs, GENERATED_DIR, name);
    if (fileExists(dest)) continue;
    console.log(`  - ${prefix}${verb} ${GENERATED_DIR}/${name}  (placeholder)`);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(generatedSrc, name), dest);
    }
    deployed++;
  }

  return deployed;
}

/** Placeholder images for figures that only exist online (interactive charts, video). */
export function resolveBundledPlaceholder(variant: 'interactive' | 'video'): string {
  return path.join(path.dirname(resolveBundledMetaJdhPath()), 'placeholders', `${variant}.svg`);
}
