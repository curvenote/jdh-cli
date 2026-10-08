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

/**
 * Image outputs of code cells with no figure, table, sound or video tag. The
 * website shows these after the code (JDH-046); hidden cells and the cover are
 * left out. The first usable image of each cell is taken.
 */
export function untaggedImageOutputs(nb: RawNotebook): UntaggedImage[] {
  const found: UntaggedImage[] = [];
  (nb.cells ?? []).forEach((cell, index) => {
    if (cell.cell_type !== 'code') return;
    const tags = ((cell.metadata?.tags as string[] | undefined) ?? []).map(String);
    if (kindFromTags(tags) || tags.includes('hidden') || tags.some((t) => t.startsWith('cover'))) return;
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
    const code = source.trim();
    if (!code) return;
    for (const { mime, data } of selectOutputs(cell.outputs ?? []).outputs) {
      if (!IMAGE_MIMES.includes(mime)) continue;
      const bytes = mime === 'image/svg+xml' ? Buffer.from(data) : Buffer.from(data.replace(/\s+/g, ''), 'base64');
      // Trust the bytes, not the MIME label (some "image/png" outputs are WebP).
      const ext = mime === 'image/svg+xml' ? 'svg' : imageFormat(bytes);
      if (!ext) continue;
      found.push({ index, code, bytes, ext });
      return;
    }
  });
  return found;
}

/** Image directive placed after the cell's code: unnumbered, no caption. */
export function imageBlock(rel: string): string {
  return ['', '```{image} ' + rel, ':width: 100%', ':align: center', '```'].join('\n');
}

/**
 * Place each image after its code cell's fence in article.md. A cell is found
 * by its whole code (Jupytext copies it verbatim; many cells share a first
 * line), searching forward.
 */
export function placeUntaggedImages(
  md: string,
  images: readonly { index: number; code: string; rel: string }[],
): { content: string; placed: number[]; missing: number[] } {
  const lines = md.split('\n');
  const fences = findJupytextCells(lines).filter((c) => c.type === 'code');
  const after = new Map<number, string>();
  const placed: number[] = [];
  const missing: number[] = [];
  let next = 0;
  for (const img of images) {
    const at = fences.findIndex((f, i) => i >= next && lines.slice(f.start + 1, f.end).join('\n').trim() === img.code);
    if (at < 0) {
      missing.push(img.index);
      continue;
    }
    next = at + 1;
    after.set(fences[at].end, imageBlock(img.rel));
    placed.push(img.index);
  }
  const out: string[] = [];
  lines.forEach((line, i) => {
    out.push(line);
    const block = after.get(i);
    if (block) out.push(block);
  });
  return { content: out.join('\n'), placed, missing };
}

/** Show image outputs of untagged code cells after their code, as the JDH website does (JDH-046). */
export const improveUntaggedImageOutputsStep: PipelineStep = {
  id: 'improveUntaggedImageOutputs',
  label: 'Image outputs of untagged code cells',
  inputs: ['markdown', 'ipynb'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const notebookPath = path.resolve(o.cwd, 'article.ipynb');
    if (!fs.existsSync(notebookPath)) return;
    const images = untaggedImageOutputs(JSON.parse(fs.readFileSync(notebookPath, 'utf8')) as RawNotebook);
    if (!images.length) {
      process.stdout.write('No image outputs in untagged code cells.\n');
      return;
    }
    const withPaths = images.map((img) => ({ ...img, rel: `${OUTPUTS_DIR}/cell-${img.index}.${img.ext}` }));
    const articlePath = path.resolve(o.cwd, 'article.md');
    const { content, placed, missing } = placeUntaggedImages(fs.readFileSync(articlePath, 'utf8'), withPaths);
    if (!o.dryRun) {
      for (const img of withPaths.filter((w) => placed.includes(w.index))) {
        const dest = path.resolve(o.cwd, img.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, img.bytes);
      }
      fs.writeFileSync(articlePath, content, 'utf8');
    }
    process.stdout.write(`Placed ${placed.length} image output(s) of untagged code cells (cells ${placed.join(', ')}).\n`);
    if (missing.length) process.stdout.write(`Warning: code for cell(s) ${missing.join(', ')} not found in article.md; images left out.\n`);
  },
};
