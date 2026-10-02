import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { findJupytextCells } from '../shared/jupytext-cells.js';
import { kindFromTags } from '../shared/notebook-cells.js';
import { firstFigureTag } from './improve-notebook-figures.js';

const ANCHOR_TAG = /^anchor-/i;
const DIALOG_TAG = /^dialog(?:ue)?(?=$|[-_:])/i;

/** MyST label for an anchor tag: `anchor-section-2-*` → `anchor-section-2`. */
export function anchorLabel(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+$/, '');
}

/**
 * Make `[text](#anchor-…)` links resolve. A figure, video or sound cell is linked
 * through its own label; any other cell gets a `(anchor-…)=` target (inside a
 * markdown region, or in front of a code fence). Table and dialogue cells are
 * left to their own steps, which need the region to hold only the table.
 */
export function processArticle(content: string): { content: string; anchors: string[] } {
  const lines = content.split('\n');
  const targets = new Map<string, string>();
  const inserts = new Map<number, string>();
  for (const cell of findJupytextCells(lines)) {
    const anchors = cell.tags.filter((t) => ANCHOR_TAG.test(t) && !targets.has(t));
    if (!anchors.length) continue;
    if (kindFromTags(cell.tags)?.kind === 'table' || cell.tags.some((t) => DIALOG_TAG.test(t))) continue;
    let label = firstFigureTag(cell.tags);
    if (!label) {
      // A target placed in front of a labelled figure would replace its label, so only here.
      label = anchorLabel(anchors[0]);
      inserts.set(cell.type === 'markdown' ? cell.start + 1 : cell.start, `(${label})=`);
    }
    for (const anchor of anchors) targets.set(anchor, label);
  }
  if (!targets.size) return { content, anchors: [] };

  const out: string[] = [];
  lines.forEach((line, i) => {
    const target = inserts.get(i);
    if (target) out.push(target);
    out.push(line);
  });
  let result = out.join('\n');
  // Match links by their clean label: `#anchor-section-3-*` reaches a cell tagged `anchor-section-3`.
  const byLabel = new Map([...targets].map(([anchor, label]) => [anchorLabel(anchor), label]));
  result = result.replace(/\]\(#(anchor-[^)\s]*)\)/gi, (link: string, anchor: string) => {
    const label = byLabel.get(anchorLabel(anchor));
    return label ? `](#${label})` : link;
  });
  return { content: result, anchors: [...targets.keys()] };
}

/** Turn JDH `anchor-*` tags into MyST link targets (JDH-017). */
export const improveJupytextAnchorsStep: PipelineStep = {
  id: 'improveJupytextAnchors',
  label: 'Improve anchors (anchor-* tags → MyST targets)',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const articlePath = path.resolve(o.cwd, 'article.md');
    const { content, anchors } = processArticle(fs.readFileSync(articlePath, 'utf8'));
    if (!anchors.length) {
      process.stdout.write('No anchor tags; no changes.\n');
      return;
    }
    if (!o.dryRun) fs.writeFileSync(articlePath, content, 'utf8');
    process.stdout.write(`${o.dryRun ? '[dry-run] Would link' : 'Linked'} ${anchors.length} anchor(s).\n`);
  },
};
