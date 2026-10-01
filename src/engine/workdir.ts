import fs from 'node:fs';
import path from 'node:path';
import { deployBundledDefaults, GENERATED_DIR, META_JDH_FILE } from '../init/bundled-assets.js';
import { authorBibWorkdirName, listProjectBibFiles } from '../steps/shared/author-bib.js';
import { deployBundledPlugins } from '../init/bundled-plugins.js';
import type { RunContext } from './types.js';
import { fileExists } from './context.js';
import {
  installSuppliedSidebarImages,
  pointExportsAtSidebarImages,
  reportSidebarImages,
  SIDEBAR_IMAGES,
} from './sidebar-images.js';
import { copyTree } from './spawn-script.js';

/** Optional siblings copied into the workdir when present (JDH article layout). */
export const WORKDIR_DEPENDENCIES: readonly string[] = [
  'article.ipynb',
  'myst.yml',
  'curvenote.yml',
  'meta-jdh.yml',
  'data',
  'media',
  'generated',
  'pretrained_models',
  'requirements.txt',
  'runtime.txt',
];

/**
 * Wipe and recreate the workdir, copy the input markdown as article.md,
 * and copy optional project dependencies from projectRoot.
 */
export async function prepareWorkdir(ctx: RunContext): Promise<void> {
  const { projectRoot, workdirAbs, inputAbs, options } = ctx;

  const rel = path.relative(projectRoot, workdirAbs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to use workdir outside project root (${workdirAbs} vs ${projectRoot})`,
    );
  }

  const prefix = options.dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}Workdir: ${workdirAbs}`);

  if (fileExists(workdirAbs)) {
    console.log(`${prefix}${options.dryRun ? 'would remove' : 'Removing'} existing workdir`);
    if (!options.dryRun) fs.rmSync(workdirAbs, { recursive: true, force: true });
  }
  console.log(`${prefix}${options.dryRun ? 'would create' : 'Creating'} workdir`);
  if (!options.dryRun) fs.mkdirSync(workdirAbs, { recursive: true });

  const articleDest = path.join(workdirAbs, 'article.md');
  console.log(`  - ${options.dryRun ? 'would copy' : 'copy    '} input → article.md`);
  if (!options.dryRun) {
    fs.copyFileSync(inputAbs, articleDest);
  }

  let copied = 1;
  let skipped = 0;
  for (const dep of WORKDIR_DEPENDENCIES) {
    const src = path.join(projectRoot, dep);
    const dest = path.join(workdirAbs, dep);
    if (!fileExists(src)) {
      console.log(`  - skip   ${dep}  (not present in project root)`);
      skipped++;
      continue;
    }
    console.log(`  - ${options.dryRun ? 'would copy' : 'copy    '} ${dep}`);
    if (!options.dryRun) copyTree(src, dest);
    copied++;
  }

  // Author-supplied bibliographies (e.g. direct.bib); registered by the citations step.
  for (const bib of listProjectBibFiles(projectRoot)) {
    const dest = authorBibWorkdirName(bib);
    console.log(`  - ${options.dryRun ? 'would copy' : 'copy    '} ${bib}${dest !== bib ? ` → ${dest}` : ''}`);
    if (!options.dryRun) fs.copyFileSync(path.join(projectRoot, bib), path.join(workdirAbs, dest));
    copied++;
  }

  const pluginCount = deployBundledPlugins(workdirAbs, options.dryRun);
  copied += pluginCount;
  // QR code and fingerprint: --qr-code / --fingerprint, else the repo's generated/, else placeholders.
  const supplied = await installSuppliedSidebarImages(
    workdirAbs,
    { qrCode: options.qrCode, fingerprint: options.fingerprint },
    options.dryRun,
  );
  const suppliedFiles = new Set(SIDEBAR_IMAGES.filter((i) => supplied.has(i.exportKey)).map((i) => i.file));
  const fromRepo = new Set(
    SIDEBAR_IMAGES.filter((i) => !suppliedFiles.has(i.file) && fileExists(path.join(workdirAbs, GENERATED_DIR, i.file))).map(
      (i) => i.file,
    ),
  );
  copied += supplied.size;
  copied += deployBundledDefaults(workdirAbs, options.dryRun, suppliedFiles);
  if (!options.dryRun) {
    for (const config of [META_JDH_FILE, 'myst.yml']) pointExportsAtSidebarImages(path.join(workdirAbs, config), supplied);
  }
  reportSidebarImages(supplied, fromRepo);

  // Keep the generated workdir out of the article repo without touching its .gitignore.
  if (!options.dryRun) fs.writeFileSync(path.join(workdirAbs, '.gitignore'), '*\n');

  console.log(
    `${prefix}Done. ${copied} item(s) ${options.dryRun ? 'would be ' : ''}copied, ${skipped} skipped.`,
  );
}
