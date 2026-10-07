import fs from 'node:fs';
import path from 'node:path';
import { isSeq } from 'yaml';
import { GENERATED_DIR } from '../init/bundled-assets.js';
import { imageFormat, isSvg } from '../steps/shared/image-format.js';
import { updateYamlFile } from '../steps/shared/yaml-doc.js';
import { fileExists } from './context.js';

/**
 * QR code and fingerprint images for the PDF sidebar (JDH-011).
 *
 * Precedence: `--qr-code` / `--fingerprint` (local path or URL) → the article
 * repo's own `generated/qr.png` / `generated/fingerprint.png` → bundled placeholder.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SidebarImageFlags {
  qrCode?: string;
  fingerprint?: string;
}

export const SIDEBAR_IMAGES = [
  { file: 'qr.png', option: 'qrCode', flag: '--qr-code', exportKey: 'qr_code', label: 'QR code', noun: 'QR code' },
  { file: 'fingerprint.png', option: 'fingerprint', flag: '--fingerprint', exportKey: 'fingerprint', label: 'Fingerprint', noun: 'fingerprint' },
] as const;

const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Bytes of a local file (relative to the current directory) or an http(s) URL. */
export async function readImageSource(spec: string, fetchImpl: Fetch = fetch): Promise<Buffer> {
  if (/^https?:\/\//i.test(spec)) {
    let res: Response;
    try {
      res = await fetchImpl(spec, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`could not download ${spec}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (!res.ok) throw new Error(`could not download ${spec}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const abs = path.resolve(spec);
  if (!fileExists(abs)) throw new Error(`file not found: ${abs}`);
  return fs.readFileSync(abs);
}

/**
 * Write the images given on the command line to `generated/<name>.<ext>`.
 * The extension follows the bytes (Typst picks the decoder from the extension).
 * Returns the export key → workdir-relative path for each image written.
 */
export async function installSuppliedSidebarImages(
  workdirAbs: string,
  flags: SidebarImageFlags,
  dryRun: boolean,
  fetchImpl: Fetch = fetch,
): Promise<Map<string, string>> {
  const supplied = new Map<string, string>();
  for (const img of SIDEBAR_IMAGES) {
    const spec = flags[img.option];
    if (!spec) continue;
    let bytes: Buffer;
    try {
      bytes = await readImageSource(spec, fetchImpl);
    } catch (err) {
      throw new Error(`${img.flag}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    const ext = isSvg(bytes) ? 'svg' : imageFormat(bytes);
    if (!ext) throw new Error(`${img.flag}: ${spec} is not a PNG, JPEG, GIF or SVG image`);
    const rel = `${GENERATED_DIR}/${path.parse(img.file).name}.${ext}`;
    console.log(`  - ${dryRun ? 'would write' : 'write   '} ${rel}  (${img.flag} ${spec})`);
    if (!dryRun) {
      const dest = path.join(workdirAbs, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // Drop the repo's copy so only the supplied image is in generated/.
      fs.rmSync(path.join(workdirAbs, GENERATED_DIR, img.file), { force: true });
      fs.writeFileSync(dest, bytes);
    }
    supplied.set(img.exportKey, `./${rel}`);
  }
  return supplied;
}

/** Set template options (`qr_code`, `fingerprint`, `article_url`, …) on every templated export in a MyST config file. */
export function pointExportsAtSidebarImages(configPath: string, paths: ReadonlyMap<string, string | boolean>): boolean {
  if (!paths.size || !fileExists(configPath)) return false;
  return updateYamlFile(configPath, (doc) => {
    const exports = doc.getIn(['project', 'exports']);
    if (!isSeq(exports)) return;
    exports.items.forEach((_item, i) => {
      if (!doc.hasIn(['project', 'exports', i, 'template'])) return;
      for (const [key, rel] of paths) doc.setIn(['project', 'exports', i, key], rel);
    });
  });
}

/** Say where each sidebar image came from; warn when the PDF will show a placeholder. */
export function reportSidebarImages(supplied: ReadonlyMap<string, string>, fromRepo: ReadonlySet<string>): void {
  for (const img of SIDEBAR_IMAGES) {
    if (supplied.has(img.exportKey)) {
      console.log(`${img.label}: ${supplied.get(img.exportKey)} (from ${img.flag})`);
    } else if (fromRepo.has(img.file)) {
      console.log(`${img.label}: ${GENERATED_DIR}/${img.file} from the article repo`);
    } else {
      console.log(
        `Warning: no ${img.noun} given (${img.flag} <path|url>) and none in the repo's ` +
          `${GENERATED_DIR}/${img.file}; the PDF will show a PLACEHOLDER ${img.noun}.`,
      );
    }
  }
}
