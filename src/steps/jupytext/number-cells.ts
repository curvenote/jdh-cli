import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import type { RawNotebook } from '../shared/notebook-cells.js';

/**
 * Cell sections the JDH website treats as metadata: they get no paragraph
 * number (`SectionChoices` in C2DH/journal-of-digital-history).
 */
const METADATA_SECTIONS = ['title', 'abstract', 'contributor', 'collaborators', 'keywords', 'disclaimer'];
/** Tag prefixes the website reads as figures (`AvailableFigureRefPrefixes`); a tag must start with one. */
const FIGURE_PREFIXES = ['figure-', 'table-', 'quote-', 'dialog-', 'sound-', 'video-', 'gallery-', 'cover', 'data-table-'];
/** Cells moved out of the body by earlier steps (front matter, parts) or kept whole by later ones. */
const NO_MARKER_TAGS = /^(copyright|dialog(?:ue)?(?:$|[-_:]))/i;

export interface NumberedCell {
  index: number;
  /** The website's paragraph number, or null for metadata cells. */
  num: number | null;
  /** True when the PDF should show the number (a visible markdown cell). */
  shown: boolean;
}

function sourceOf(cell: { source?: string | string[] }): string {
  return Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
}

/**
 * Paragraph numbers as the JDH website gives them (`src/logic/ipynb.jsx`):
 * every cell takes the next number except metadata cells (title, abstract,
 * contributor, …) that are not figures or hidden. Only markdown cells show
 * theirs, so code, figure and hidden cells leave gaps.
 */
export function websiteCellNumbers(nb: RawNotebook): NumberedCell[] {
  let n = 0;
  return (nb.cells ?? []).map((cell, index) => {
    const tags = ((cell.metadata?.tags as string[] | undefined) ?? []).map(String);
    const source = sourceOf(cell);
    const isFigure = tags.some((t) => FIGURE_PREFIXES.some((p) => t.startsWith(p)));
    const jdh = cell.metadata?.jdh as { hidden?: boolean } | undefined;
    const isHidden = source.length === 0 || tags.includes('hidden') || Boolean(jdh?.hidden);
    const isMetadata = !isFigure && !isHidden && tags.some((t) => METADATA_SECTIONS.includes(t));
    const num = isMetadata ? null : ++n;
    const shown =
      num !== null && cell.cell_type === 'markdown' && !isFigure && !isHidden && !tags.some((t) => NO_MARKER_TAGS.test(t));
    return { index, num, shown };
  });
}

/** Typst marker for the template: the next block shows this number (JDH-042). */
export function cellMarker(num: number): string {
  return ['```{raw:typst}', `#jdh-cell(${num})`, '```', ''].join('\n');
}

/**
 * Put a number marker in front of each shown markdown cell of `article.md`.
 * Cells are found by the start of their first line, searching forward
 * (Jupytext copies markdown cells verbatim); a cell with metadata gets the marker before its
 * `<!-- #region … -->` line. Returns the article and the cells not found.
 */
export function markCellNumbers(md: string, nb: RawNotebook): { content: string; marked: number; missing: number[] } {
  const lines = md.split('\n');
  const inserts = new Map<number, number>();
  const missing: number[] = [];
  let cursor = 0;
  const cells = nb.cells ?? [];
  for (const { index, num, shown } of websiteCellNumbers(nb)) {
    if (!shown || num === null) continue;
    const first = sourceOf(cells[index])
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    if (!first) continue;
    // Match the start of the line: later edits (e.g. citations rewritten for a
    // local .bib) may change the rest of it.
    const key = first.slice(0, 40);
    let at = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (lines[i].trim().startsWith(key)) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      missing.push(index);
      continue;
    }
    cursor = at + 1;
    // Step back over blank lines to a region opening, if this cell has one.
    let open = at - 1;
    while (open >= 0 && !lines[open].trim()) open--;
    const target = open >= 0 && /^<!--\s*#(region|raw)/.test(lines[open]) ? open : at;
    inserts.set(target, num);
  }
  const out: string[] = [];
  lines.forEach((line, i) => {
    const num = inserts.get(i);
    if (num !== undefined) out.push(cellMarker(num));
    out.push(line);
  });
  return { content: out.join('\n'), marked: inserts.size, missing };
}

/**
 * Number paragraphs as the JDH website does: one number per notebook cell,
 * shown on the cell's first block (JDH-042). Runs before any step rewrites
 * cell text, so the cells can be found verbatim.
 */
export const numberCellsStep: PipelineStep = {
  id: 'numberCells',
  label: 'Number cells as the JDH website does',
  inputs: ['markdown', 'ipynb'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const articlePath = path.resolve(o.cwd, 'article.md');
    const notebookPath = path.resolve(o.cwd, 'article.ipynb');
    if (!fs.existsSync(notebookPath)) {
      process.stdout.write('No article.ipynb; paragraphs are numbered in order.\n');
      return;
    }
    const nb = JSON.parse(fs.readFileSync(notebookPath, 'utf8')) as RawNotebook;
    const { content, marked, missing } = markCellNumbers(fs.readFileSync(articlePath, 'utf8'), nb);
    if (!o.dryRun) fs.writeFileSync(articlePath, content, 'utf8');
    process.stdout.write(`${o.dryRun ? '[dry-run] Would number' : 'Numbered'} ${marked} cell(s) as on the JDH website.\n`);
    if (missing.length) {
      process.stdout.write(
        `Warning: ${missing.length} markdown cell(s) not found in article.md (cells ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}); their paragraphs get no number.\n`,
      );
    }
  },
};
