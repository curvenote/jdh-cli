import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from './context.js';

export const DEFAULT_WORKDIR = '_improved';

/** Resolve project root (absolute). */
export function resolveProjectRoot(projectRoot?: string): string {
  return path.resolve(projectRoot ?? process.cwd());
}

/** Resolve workdir path inside project root; throws if outside root. */
export function resolveWorkdirAbs(projectRoot: string, workdir = DEFAULT_WORKDIR): string {
  const workdirAbs = path.isAbsolute(workdir)
    ? workdir
    : path.resolve(projectRoot, workdir);

  const rel = path.relative(projectRoot, workdirAbs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to use workdir outside project root (${workdirAbs} vs ${projectRoot})`,
    );
  }

  return workdirAbs;
}

/** Legacy `.bak` files from the old in-place pipeline flow. */
export const LEGACY_ARTIFACTS: readonly string[] = ['article.md.bak', 'curvenote.yml.bak'];

export function removeLegacyArtifacts(projectRoot: string, dryRun: boolean): number {
  let removed = 0;
  for (const f of LEGACY_ARTIFACTS) {
    const p = path.join(projectRoot, f);
    if (!fileExists(p)) continue;
    console.log(`${dryRun ? '[dry-run] would remove legacy' : 'Removing legacy'} ${f}`);
    if (!dryRun) fs.unlinkSync(p);
    removed++;
  }
  return removed;
}
