import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { imageFormat } from '../shared/image-format.js';
import { findJupytextCells } from '../shared/jupytext-cells.js';
import { kindFromTags, selectOutputs, type RawNotebook } from '../shared/notebook-cells.js';

const OUTPUTS_DIR = 'notebook-outputs';
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'];

export interface UntaggedImage {
  /** Notebook cell index. */
  index: number;
  /** The cell's code, to find its fence in article.md. */
  code: string;
  bytes: Buffer;
  ext: 'png' | 'jpg' | 'gif' | 'svg';
}

export interface CoverImage {
  index: number;
  code: string;
  /** Image file the code displays, e.g. `media/cover.jpg`. */
  imagePath: string | null;
  /** The cell's stored image, used when the file is missing. */
  output: { bytes: Buffer; ext: UntaggedImage['ext'] } | null;
}

function cellTags(cell: { metadata?: Record<string, unknown> }): string[] {
  return ((cell.metadata?.tags as string[] | undefined) ?? []).map(String);
}

function cellCode(cell: { source?: string | string[] }): string {
  return (Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')).trim();
}

/** First image output in a format Typst reads. */
function firstImage(outputs: Parameters<typeof selectOutputs>[0]): { bytes: Buffer; ext: UntaggedImage['ext'] } | null {
  for (const { mime, data } of selectOutputs(outputs).outputs) {
    if (!IMAGE_MIMES.includes(mime)) continue;
    const bytes = mime === 'image/svg+xml' ? Buffer.from(data) : Buffer.from(data.replace(/\s+/g, ''), 'base64');
    // Trust the bytes, not the MIME label (some "image/png" outputs are WebP).
    const ext = mime === 'image/svg+xml' ? 'svg' : imageFormat(bytes);
    if (ext) return { bytes, ext };
  }
  return null;
}

/**
 * Image outputs of code cells with no figure, table, sound or video tag. The
 * website shows these after the code (JDH-046); hidden cells and the cover are
 * left out. The first usable image of each cell is taken.
 */
export function untaggedImageOutputs(nb: RawNotebook): UntaggedImage[] {
  const found: UntaggedImage[] = [];
  (nb.cells ?? []).forEach((cell, index) => {
    if (cell.cell_type !== 'code') return;
    const tags = cellTags(cell);
    if (kindFromTags(tags) || tags.includes('hidden') || tags.some((t) => t.startsWith('cover'))) return;
    const code = cellCode(cell);
    if (!code) return;
    const image = firstImage(cell.outputs ?? []);
    if (image) found.push({ index, code, ...image });
  });
  return found;
}

/**
 * Code cells tagged `cover`. The PDF shows the image in place of the code
 * (JDH-055), as the website does.
 */
export function coverCells(nb: RawNotebook): CoverImage[] {
  return (nb.cells ?? []).flatMap((cell, index) => {
    if (cell.cell_type !== 'code' || !cellTags(cell).some((t) => t.startsWith('cover'))) return [];
    const code = cellCode(cell);
    if (!code) return [];
    const imagePath = code.match(/\bImage\s*\(\s*(?:filename\s*=\s*)?["']([^"']+)["']/)?.[1] ?? null;
    return [{ index, code, imagePath, output: firstImage(cell.outputs ?? []) }];
  });
}

/** Image directive placed after the cell's code: unnumbered, no caption. */
export function imageBlock(rel: string): string {
  return ['', '```{image} ' + rel, ':width: 100%', ':align: center', '```'].join('\n');
}

/**
 * Place each image after its code cell's fence in article.md, or in place of
 * the fence when `replace` is set (the cover). A cell is found by its whole
 * code (Jupytext copies it verbatim; many cells share a first line), searching
 * forward.
 */
export function placeUntaggedImages(
  md: string,
  images: readonly { index: number; code: string; rel: string; replace?: boolean }[],
): { content: string; placed: number[]; missing: number[] } {
  const lines = md.split('\n');
  const fences = findJupytextCells(lines).filter((c) => c.type === 'code');
  const after = new Map<number, string>();
  const dropped = new Set<number>();
  const placed: number[] = [];
  const missing: number[] = [];
  let next = 0;
  for (const img of [...images].sort((a, b) => a.index - b.index)) {
    const at = fences.findIndex((f, i) => i >= next && lines.slice(f.start + 1, f.end).join('\n').trim() === img.code);
    if (at < 0) {
      missing.push(img.index);
      continue;
    }
    next = at + 1;
    after.set(fences[at].end, imageBlock(img.rel));
    if (img.replace) for (let i = fences[at].start; i <= fences[at].end; i++) dropped.add(i);
    placed.push(img.index);
  }
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!dropped.has(i)) out.push(line);
    const block = after.get(i);
    if (block) out.push(block);
  });
  return { content: out.join('\n'), placed, missing };
}

/** Show image outputs of untagged code cells after their code, and the cover in place of its code, as the JDH website does (JDH-046, JDH-055). */
export const improveUntaggedImageOutputsStep: PipelineStep = {
  id: 'improveUntaggedImageOutputs',
  label: 'Image outputs of untagged code cells',
  inputs: ['markdown', 'ipynb'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const notebookPath = path.resolve(o.cwd, 'article.ipynb');
    if (!fs.existsSync(notebookPath)) return;
    const nb = JSON.parse(fs.readFileSync(notebookPath, 'utf8')) as RawNotebook;
    const images = untaggedImageOutputs(nb);
    const withPaths: { index: number; code: string; rel: string; bytes?: Buffer; replace?: boolean }[] = images.map((img) => ({
      ...img,
      rel: `${OUTPUTS_DIR}/cell-${img.index}.${img.ext}`,
    }));
    // The cover (JDH-055): the file its code displays, else its stored image; never its code.
    for (const cover of coverCells(nb)) {
      const file = cover.imagePath?.replace(/^\.\//, '');
      if (file && fs.existsSync(path.resolve(o.cwd, file))) withPaths.push({ ...cover, rel: file, replace: true });
      else if (cover.output)
        withPaths.push({ ...cover, rel: `${OUTPUTS_DIR}/cover.${cover.output.ext}`, bytes: cover.output.bytes, replace: true });
      else process.stdout.write(`Warning: cover cell ${cover.index} has no image file or stored image; left as code.\n`);
    }
    if (!withPaths.length) {
      process.stdout.write('No image outputs in untagged code cells.\n');
      return;
    }
    const articlePath = path.resolve(o.cwd, 'article.md');
    const { content, placed, missing } = placeUntaggedImages(fs.readFileSync(articlePath, 'utf8'), withPaths);
    if (!o.dryRun) {
      for (const img of withPaths.filter((w) => w.bytes && placed.includes(w.index))) {
        const dest = path.resolve(o.cwd, img.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, img.bytes!);
      }
      fs.writeFileSync(articlePath, content, 'utf8');
    }
    process.stdout.write(`Placed ${placed.length} image(s) from code cells (cells ${placed.join(', ')}).\n`);
    if (missing.length) process.stdout.write(`Warning: code for cell(s) ${missing.join(', ')} not found in article.md; images left out.\n`);
  },
};
