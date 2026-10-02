import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { findJupytextCells } from '../shared/jupytext-cells.js';

/** Remove cells tagged `hidden` (hidden on the JDH website: "Bibliography" headings, cite2c placeholders). */
export function processArticle(content: string): { content: string; dropped: number } {
  const lines = content.split('\n');
  const hidden = findJupytextCells(lines).filter((c) => c.tags.includes('hidden'));
  if (!hidden.length) return { content, dropped: 0 };
  const drop = new Set<number>();
  for (const cell of hidden) {
    for (let i = cell.start; i <= cell.end; i++) drop.add(i);
    // The blank line that separated the cell from the next one.
    if (lines[cell.end + 1] === '') drop.add(cell.end + 1);
  }
  return { content: lines.filter((_, i) => !drop.has(i)).join('\n'), dropped: hidden.length };
}

/** Drop JDH `hidden` cells from the article (JDH-017). */
export const dropHiddenCellsStep: PipelineStep = {
  id: 'dropHiddenCells',
  label: 'Drop hidden cells',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const articlePath = path.resolve(o.cwd, 'article.md');
    const { content, dropped } = processArticle(fs.readFileSync(articlePath, 'utf8'));
    if (!dropped) {
      process.stdout.write('No hidden cells; no changes.\n');
      return;
    }
    if (!o.dryRun) fs.writeFileSync(articlePath, content, 'utf8');
    process.stdout.write(`${o.dryRun ? '[dry-run] Would drop' : 'Dropped'} ${dropped} hidden cell(s).\n`);
  },
};
