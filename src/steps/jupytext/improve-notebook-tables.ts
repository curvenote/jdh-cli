import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { outputTableToGfm, tableFromOutputs } from '../shared/html-table.js';
import {
  captionFromCode,
  captionFromJdh,
  kindFromTags,
  loadNotebook,
  parseFenceMetadata,
  readTaggedCells,
  resolveCaption,
  tableLabelFromTag,
  type TaggedCell,
} from '../shared/notebook-cells.js';

const DEFAULT_ARTICLE = 'article.md';
const DEFAULT_NOTEBOOK = 'article.ipynb';

export interface TableReport {
  converted: string[];
  /** Table cells left as code, with the reason (e.g. no table in the notebook output). */
  skipped: { label: string; reason: string }[];
  captionConflicts: { label: string; used: string; others: string[] }[];
}

function parseTagsFromFenceLine(line: string): string[] {
  const match = line.match(/tags\s*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/** One-line caption for the directive argument, without a "Table N:" prefix (numbering is automatic). */
function cleanCaption(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Table\s+\d+[.:]\s*/i, '');
}

/**
 * Replace table-tagged code cells with a `{jdh-table}` built from the
 * cell's notebook output (pandas/HTML table, else a markdown table). The code is
 * dropped from the PDF, as for figures. Cells with no table output stay as code.
 */
export function processArticle(
  content: string,
  notebookCells: readonly TaggedCell[] = [],
): { content: string; report: TableReport } {
  const report: TableReport = { converted: [], skipped: [], captionConflicts: [] };
  // Notebook table cells by tag, in order (a tag can repeat).
  const byTag = new Map<string, TaggedCell[]>();
  for (const cell of notebookCells) {
    if (cell.kind !== 'table') continue;
    byTag.set(cell.tag, [...(byTag.get(cell.tag) ?? []), cell]);
  }

  // Any kernel language (python, R, …); `{directive}` fences don't match.
  const fenceRe = /^```[A-Za-z][\w+-]*[ \t]*(.*)\n([\s\S]*?)^```[ \t]*$/gm;
  return {
    content: content.replace(fenceRe, (block: string, tagLine: string, body: string) => {
      const found = kindFromTags(parseTagsFromFenceLine(tagLine));
      if (found?.kind !== 'table') return block;
      const label = tableLabelFromTag(found.tag);
      const cell = byTag.get(found.tag)?.shift();
      const table = cell ? tableFromOutputs(cell.outputs) : null;
      if (!table) {
        const mimes = cell?.outputs.map((o) => o.mime) ?? [];
        report.skipped.push({
          label,
          reason: !cell
            ? 'no matching notebook cell'
            : mimes.length
              ? `no table in notebook output ${mimes.join(', ')}`
              : 'no notebook output',
        });
        return block;
      }

      const captions = {
        code: captionFromCode(body),
        cell: captionFromJdh(parseFenceMetadata(tagLine, 'jdh')) ?? cell!.captions.cell,
        output: cell!.captions.output,
      };
      const resolved = resolveCaption(captions);
      if (resolved.conflict) {
        report.captionConflicts.push({
          label,
          used: resolved.from!,
          others: (['code', 'cell', 'output'] as const).filter((k) => k !== resolved.from && captions[k]),
        });
      }
      const caption = cleanCaption(resolved.text ?? table.caption ?? '');
      const { markdown, headerRows } = outputTableToGfm(table);
      report.converted.push(label);
      return [
        ':::{jdh-table}' + (caption ? ` ${caption.replace(/`/g, '\\`')}` : ''),
        `:label: ${label}`,
        ':align: center',
        ...(headerRows > 1 ? [`:header-rows: ${headerRows}`] : []),
        ...(table.totalRows ? [`:total-rows: ${table.totalRows}`] : []),
        ...(table.totalColumns ? [`:total-columns: ${table.totalColumns}`] : []),
        '',
        markdown,
        ':::',
      ].join('\n');
    }),
    report,
  };
}

async function improveNotebookTables(options: {
  article: string;
  notebook: string;
  dryRun: boolean;
  cwd: string;
}): Promise<void> {
  const articlePath = path.resolve(options.cwd, options.article || DEFAULT_ARTICLE);
  if (!fs.existsSync(articlePath)) throw new Error(`Article not found: ${articlePath}`);
  const notebook = loadNotebook(path.resolve(options.cwd, options.notebook || DEFAULT_NOTEBOOK));
  if (!notebook) {
    process.stdout.write('No article.ipynb in workdir; table outputs unavailable.\n');
    return;
  }

  const content = fs.readFileSync(articlePath, 'utf8');
  const { content: newContent, report } = processArticle(content, readTaggedCells(notebook));
  for (const c of report.captionConflicts) {
    process.stdout.write(
      `Warning: ${c.label} caption differs between ${[c.used, ...c.others].join(', ')}; using ${c.used}.\n`,
    );
  }
  for (const s of report.skipped) process.stdout.write(`Left as code: ${s.label} (${s.reason}).\n`);
  if (newContent === content) {
    process.stdout.write('No table-tagged code cells converted; no changes.\n');
    return;
  }
  if (!options.dryRun) fs.writeFileSync(articlePath, newContent, 'utf8');
  process.stdout.write(
    `${options.dryRun ? '[dry-run] Would convert' : 'Converted'} ${report.converted.length} table output(s): ` +
      `${report.converted.join(', ')}.\n`,
  );
}

/**
 * Turn table-tagged code cells into `{jdh-table}` directives from their notebook
 * output (JDH-003). Runs before improveJupytextTables, which updates references.
 */
export const improveNotebookTablesStep: PipelineStep = {
  id: 'improveNotebookTables',
  label: 'Improve notebook tables (dataframe outputs to jdh-table)',
  inputs: ['markdown', 'ipynb'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await improveNotebookTables({ article: 'article.md', notebook: 'article.ipynb', dryRun: o.dryRun, cwd: o.cwd });
  },
};
