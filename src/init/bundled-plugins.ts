import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists } from '../engine/context.js';

const PLUGINS_DIR = 'plugins';

/** Resolve the directory containing bundled MyST plugins shipped with jdh-cli. */
export function resolveBundledPluginsDir(): string {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
  const candidates: string[] = [];

  if (entry) {
    candidates.push(path.join(path.dirname(entry), PLUGINS_DIR));
    candidates.push(path.join(path.dirname(entry), '..', 'templates', PLUGINS_DIR));
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // Source layout (`src/init/…` during dev / tests).
  candidates.push(path.join(moduleDir, '..', '..', 'templates', PLUGINS_DIR));
  candidates.push(path.join(moduleDir, '..', '..', 'dist', PLUGINS_DIR));
  // Shipped bundle (`dist/jdh-cli.cjs` — moduleDir is `dist/`).
  candidates.push(path.join(moduleDir, '..', 'templates', PLUGINS_DIR));
  candidates.push(path.join(moduleDir, PLUGINS_DIR));

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }

  throw new Error(
    `Bundled ${PLUGINS_DIR}/ directory not found. Rebuild jdh-cli: bun run build`,
  );
}

/** Basenames of every bundled `*.mjs` plugin (sorted). */
function listBundledPluginFiles(): string[] {
  const dir = resolveBundledPluginsDir();
  const plugins = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .sort();

  if (plugins.length === 0) {
    throw new Error(`No bundled plugins (*.mjs) found in ${dir}`);
  }

  return plugins;
}

/** Relative myst.yml plugin paths for every bundled `*.mjs` plugin. */
export function listBundledPluginRelPaths(): string[] {
  return listBundledPluginFiles().map((name) => `${PLUGINS_DIR}/${name}`);
}

/** Copy all bundled plugins (including `plugins/lib/`) into `<workdir>/plugins/`. */
export function deployBundledPlugins(workdirAbs: string, dryRun: boolean): number {
  const srcDir = resolveBundledPluginsDir();
  const destDir = path.join(workdirAbs, PLUGINS_DIR);
  const plugins = listBundledPluginFiles();

  const prefix = dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}Deploying ${plugins.length} bundled plugin(s) → ${PLUGINS_DIR}/`);

  if (!dryRun) {
    copyPluginsTree(srcDir, destDir);
  }

  for (const name of plugins) {
    console.log(`  - ${prefix}${dryRun ? 'would copy' : 'copy    '} ${PLUGINS_DIR}/${name}`);
  }

  return plugins.length;
}

function copyPluginsTree(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    if (fs.statSync(srcPath).isDirectory()) {
      copyPluginsTree(srcPath, destPath);
    } else if (name.endsWith('.mjs')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
