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
