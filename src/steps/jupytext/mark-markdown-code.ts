import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { findJupytextCells } from '../shared/jupytext-cells.js';

/** Class put on a markdown-cell code fence so the Typst plugins can tell it from real code. */
export const MARKDOWN_CODE_CLASS = 'jdh-markdown-code';

/** A plain fence: ``` or ```lang. Not a directive (```{figure}) and not an attrs fence. */
const PLAIN_FENCE = /^(`{3,})([A-Za-z0-9_+-]*)\s*$/;

/**
 * Mark code fences that an author wrote inside a *markdown* cell (JDH-100).
 *
 * JDH's rule, from the 20 Nov call: a standard markdown code fence is "markdown
 * code" whatever its language — ```yaml, ```java and a bare ``` are all the same
 * thing — and it is styled by the layer it sits in rather than as executable code.
 *
 * The distinction cannot be made further down the pipeline. By the time MyST parses
 * the document, a notebook code cell and a fence an author typed into a markdown
 * cell are both plain `code` nodes, and the fence text alone does not separate
 * them: across the corpus, 5 articles write every one of their code cells as a bare
 * ```lang fence with no metadata — BHmHNQKJaSWT does it 11 times. Classifying on
 * the fence would turn all of that real code into markdown code.
 *
 * In Jupytext markdown the structure does separate them, exactly: a markdown cell is
 * a `<!-- #region -->` block, a code cell is a top-level fence. Checked against every
 * article in the corpus, top-level fences match the notebook's code-cell count and
 * in-region fences match its markdown fences, with no mismatches. So this runs early,
 * while the region comments are still there.
 *
 * The fence becomes a `{code-block}` directive carrying a class, which survives into
 * the AST for the plugins to read. The language is kept.
 */
export function markMarkdownCode(content: string): { content: string; marked: number } {
  const lines = content.split('\n');
  const rewrite = new Map<number, string[]>();

  for (const cell of findJupytextCells(lines)) {
    if (cell.type !== 'markdown') continue;
    // Walk the region's body, pairing fence openings with their closings so that
    // the content of a fence is never scanned for further fences.
    for (let i = cell.start + 1; i < cell.end; i++) {
      const open = PLAIN_FENCE.exec(lines[i]);
      if (!open) continue;
      const [, ticks, lang] = open;
      const close = new RegExp(`^\`{${ticks.length},}\\s*$`);
      let j = i + 1;
      while (j < cell.end && !close.test(lines[j])) j++;
      if (j >= cell.end) break; // unclosed fence: leave the cell alone
      rewrite.set(i, [
        `${ticks}{code-block} ${lang || 'text'}`,
        `:class: ${MARKDOWN_CODE_CLASS}`,
        '',
      ]);
      i = j;
    }
  }

  if (!rewrite.size) return { content, marked: 0 };

  const out: string[] = [];
  lines.forEach((line, i) => {
    const replacement = rewrite.get(i);
    if (replacement) out.push(...replacement);
    else out.push(line);
  });
  return { content: out.join('\n'), marked: rewrite.size };
}

export const markMarkdownCodeStep: PipelineStep = {
  id: 'markMarkdownCode',
  label: 'Mark markdown-cell code fences (JDH-100)',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const articlePath = path.resolve(o.cwd, 'article.md');
    const { content, marked } = markMarkdownCode(fs.readFileSync(articlePath, 'utf8'));
    if (!marked) {
      process.stdout.write('No markdown-cell code fences; no changes.\n');
      return;
    }
    if (!o.dryRun) fs.writeFileSync(articlePath, content, 'utf8');
    process.stdout.write(
      `${o.dryRun ? '[dry-run] Would mark' : 'Marked'} ${marked} markdown-cell code fence(s).\n`,
    );
  },
};
