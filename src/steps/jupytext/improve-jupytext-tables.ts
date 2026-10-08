import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { countHeaderRows, isSeparatorRow } from '../../../templates/plugins/lib/table-truncate.mjs';
import { captionFromJdh, kindFromTags, parseFenceMetadata, tableLabelFromTag } from '../shared/notebook-cells.js';


const DEFAULT_ARTICLE = 'article.md';

/** Tag is a table tag if it matches table:N or table-<N>-* or table_<N> (after normalization we use table:N) */
// Numbered table tags as the website reads them (`table-` first, JDH-047), or our own `table:N`.
const TABLE_TAG_PATTERN = /^(table:\d+|table-\d+[-_]?\*?)$/i;

interface RunImproveJupytextTablesOptions {
  article: string;
  dryRun: boolean;
  cwd: string;
}

function readUtf8(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function writeUtf8(p: string, content: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.writeFileSync(p, content, 'utf8');
}

/** Extract tags array from region line: tags=["table-1", "table-1-*", "data-table"] */
function parseTagsFromRegionLine(line: string): string[] {
  const match = line.match(/tags\s*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  const inner = match[1];
  const tags: string[] = [];
  const re = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) tags.push(m[1]);
  return tags;
}

/**
 * Label for a table region: numbered tags as before (table-n / table_n / table:n,
 * preferring table:N), descriptive tags as `table:<slug>` (`table-sequence-*`).
 */
function firstTableTag(tags: string[]): string | null {
  const normalized = tags.find((t) => /^table:\d+$/i.test(t));
  if (normalized) return normalized;
  for (const t of tags) {
    if (TABLE_TAG_PATTERN.test(t)) return t;
  }
  const found = kindFromTags(tags);
  return found?.kind === 'table' ? tableLabelFromTag(found.tag) : null;
}

/** Dialogue regions (`dialog-*`) belong to improveDialogueRegions, even when also tagged as a table. */
const DIALOG_TAG = /^dialog(?:ue)?(?=$|[-_:])/i;

/** Extract caption from jdh.object.source[0] in region line (unescape \u201c etc.). */
function extractCaptionFromRegionLine(line: string): string | null {
  const match = line.match(/"source"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  return match[1]
    .replace(/\\"/g, '"')
    .replace(/\\u201c/g, '\u201c')
    .replace(/\\u201d/g, '\u201d');
}

/** Strip "Table N:" or "Table N." prefix from caption for MyST (numbering is automatic). */
function stripTableNumberPrefix(caption: string): string {
  return caption.replace(/^Table\s+\d+[.:]\s*/i, '').trim();
}

/**
 * Normalize table-n-* tags to table:n (only in tags=[], :label:, and [](#...); not in metadata).
 */
function normalizeTableTags(content: string): string {
  let result = content;
  result = result.replace(/\[\]\(#table-(\d+)-\*\)/g, '[](#table:$1)');
  result = result.replace(/(:label:\s*)table-(\d+)-\*/g, '$1table:$2');
  result = result.replace(/tags=\[([^\]]*?)\]/g, (match: string, inner: string) => {
    const newInner = inner.replace(/"table-(\d+)-\*"/g, '"table:$1"');
    return newInner !== inner ? 'tags=[' + newInner + ']' : match;
  });
  return result;
}

/**
 * Process article: normalize table-n-* -> table:n, then replace table regions with MyST table directives and update refs.
 */
function processArticle(content: string): { content: string; tableNumToLabel: Map<number, string> } {
  const tableNumToLabel = new Map<number, string>();

  content = normalizeTableTags(content);

  const regionOpenRe = /^<!--\s*#region\s+(.+?)\s*-->\s*$/gm;
  const regionCloseRe = /^<!--\s*#endregion\s*-->/gm;

  type Region = {
    openStart: number;
    openEnd: number;
    openLine: string;
    tableStart: number;
    tableEnd: number;
    endRegionStart: number;
    endRegionEnd: number;
    caption: string;
    label: string;
    tableNum: number;
    anchors: string[];
  };

  const regions: Region[] = [];
  const usedLabels = new Set<string>();
  let openMatch: RegExpExecArray | null;
  regionOpenRe.lastIndex = 0;
  while ((openMatch = regionOpenRe.exec(content)) !== null) {
    const openStart = openMatch.index;
    const openEnd = openStart + openMatch[0].length;
    const openLine = openMatch[1];

    const captionRaw = captionFromJdh(parseFenceMetadata(openLine, 'jdh')) ?? extractCaptionFromRegionLine(openLine);
    const tags = parseTagsFromRegionLine(openLine);
    const tagLabel = firstTableTag(tags);
    if (!tagLabel || tags.some((t) => DIALOG_TAG.test(t))) continue;
    // A descriptive tag can repeat (two `table-sequence-*` regions): keep labels unique.
    let label = tagLabel;
    for (let n = 2; usedLabels.has(label); n++) label = `${tagLabel}-${n}`;

    const caption = captionRaw ? stripTableNumberPrefix(captionRaw) : '';
    const anchors = tags.filter((t) => /^anchor-/i.test(t));
    regionCloseRe.lastIndex = openEnd;
    const endMatch = regionCloseRe.exec(content);
    if (!endMatch) continue;

    const endRegionStart = endMatch.index;
    const endRegionEnd = endRegionStart + endMatch[0].length;

    const tableBlock = content.slice(openEnd, endRegionStart).replace(/^\n+|\n+$/g, '');
    // Only regions that are just a GFM table (every line a row, one a separator). A region
    // of prose with a table inside (MiDeVUZqdmue's "Questionnaire") is left as it is.
    const lines = tableBlock.split('\n').filter((l) => l.trim());
    if (!lines.every((l) => l.includes('|')) || !lines.some((l) => isSeparatorRow(l))) continue;

    const tableNumMatch = label.match(/(?:^table:(\d+)$|table[-_]?(\d+))/i);
    const tableNum = tableNumMatch ? parseInt(tableNumMatch[1] ?? tableNumMatch[2], 10) : 0;
    if (tableNum > 0) tableNumToLabel.set(tableNum, label);
    usedLabels.add(label);

    regions.push({
      openStart,
      openEnd,
      openLine,
      tableStart: openEnd,
      tableEnd: endRegionStart,
      endRegionStart,
      endRegionEnd,
      caption,
      label,
      tableNum,
      anchors,
    });
  }

  regions.sort((a, b) => b.openStart - a.openStart);

  let result = content;
  for (const r of regions) {
    const tableBlock = content.slice(r.openEnd, r.tableEnd).replace(/^\n+|\n+$/g, '');
    const headerRows = countHeaderRows(tableBlock);
    const headerLine =
      headerRows > 1 ? [`:header-rows: ${headerRows}`, ''] : [''];
    // Keep the region markers so a `hermeneutics` tag on the same cell still wraps
    // the table; a backtick fence nests inside the hermeneutics `:::` block.
    const replacement = [
      content.slice(r.openStart, r.openEnd).trimEnd(),
      '```{jdh-table}' + (r.caption ? ' ' + r.caption : ''),
      `:label: ${r.label}`,
      ':align: center',
      ...headerLine,
      tableBlock,
      '```',
      content.slice(r.endRegionStart, r.endRegionEnd),
    ].join('\n');

    result = result.slice(0, r.openStart) + replacement + result.slice(r.endRegionEnd);
  }

  // Links to a table's `anchor-*` tag point at its label; "table 1"-style text
  // becomes an auto-numbered reference.
  for (const r of regions) {
    for (const anchor of r.anchors) {
      const re = new RegExp(`\\[([^\\]]*)\\]\\(#${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
      result = result.replace(re, (_m: string, text: string) =>
        /^table\s+\S+$/i.test(text.trim()) ? `[](#${r.label})` : `[${text}](#${r.label})`,
      );
    }
  }

  // Tables already in the article as {jdh-table}: from earlier runs, or from
  // notebook outputs (improveNotebookTables), which may have no caption.
  {
    const existingTableRe = /(?::::|```)\s*\{jdh-table\}[^\n]*\n:label:\s*([^\s\n]+)/g;
    let em: RegExpExecArray | null;
    while ((em = existingTableRe.exec(result)) !== null) {
      const label = em[1];
      const numMatch = label.match(/(?:^table:(\d+)$|table[-_]?(\d+))/i);
      const num = numMatch ? parseInt(numMatch[1] ?? numMatch[2], 10) : 0;
      if (num && !tableNumToLabel.has(num)) tableNumToLabel.set(num, label);
    }
  }
  if (tableNumToLabel.size === 0) {
    let em: RegExpExecArray | null;
    // Legacy `{table}` blocks from earlier pipeline runs.
    const legacyTableRe = /:::\s*\{table\}[^\n]+\n:label:\s*([^\s\n]+)/g;
    while ((em = legacyTableRe.exec(result)) !== null) {
      const label = em[1];
      const numMatch = label.match(/(?:^table:(\d+)$|table[-_]?(\d+))/i);
      if (numMatch) tableNumToLabel.set(parseInt(numMatch[1] ?? numMatch[2], 10), label);
    }
  }

  const skipRanges: { start: number; end: number }[] = [];
  let dm: RegExpExecArray | null;
  const tableDirRe = /(:::|```)\s*\{jdh-table\}[^]*?\1/g;
  while ((dm = tableDirRe.exec(result)) !== null) {
    skipRanges.push({ start: dm.index, end: dm.index + dm[0].length });
  }
  const legacyDirRe = /:::\s*\{table\}[^]*?:::/g;
  while ((dm = legacyDirRe.exec(result)) !== null) {
    skipRanges.push({ start: dm.index, end: dm.index + dm[0].length });
  }
  // Region markers and other comments carry metadata (captions saying "Table 1"); never rewrite them.
  const commentRe = /<!--[\s\S]*?-->/g;
  while ((dm = commentRe.exec(result)) !== null) {
    skipRanges.push({ start: dm.index, end: dm.index + dm[0].length });
  }
  skipRanges.sort((a, b) => a.start - b.start);

  function inSkip(idx: number): boolean {
    return skipRanges.some((s) => idx >= s.start && idx < s.end);
  }

  for (const [num, label] of tableNumToLabel) {
    const linkPattern = new RegExp(`\\[Table\\s+${num}\\]\\(#[^)]*\\)`, 'gi');
    result = result.replace(linkPattern, (match: string, offset: number) => {
      if (inSkip(offset)) return match;
      return '[](#' + label + ')';
    });
    const refLiteral = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('\\{ref\\}`' + refLiteral + '`', 'g'), (match: string, offset: number) => {
      if (inSkip(offset)) return match;
      return '[](#' + label + ')';
    });
    const oldStyleRef = new RegExp('\\{ref\\}`table-' + num + '-\\*`', 'g');
    result = result.replace(oldStyleRef, (match: string, offset: number) => {
      if (inSkip(offset)) return match;
      return '[](#' + label + ')';
    });
  }

  for (const [num, label] of tableNumToLabel) {
    const re = new RegExp('(^|[^\\w{(#`])Table\\s+' + num + '\\b([^\\w}]|$)', 'gi');
    result = result.replace(re, (match: string, before: string, after: string, offset: number) => {
      if (inSkip(offset)) return match;
      return before + '[](#' + label + ')' + after;
    });
  }

  result = result.replace(/((?::::|```)\s*\{jdh-table\}\s*)Table\s+\d+[.:]\s*/gi, '$1');
  result = result.replace(/(:::\s*\{table\}\s*)Table\s+\d+[.:]\s*/gi, '$1');

  return { content: result, tableNumToLabel };
}

export { processArticle };

/**
 * Detects Jupytext table regions, wraps GFM tables in MyST `{jdh-table}` directives, and updates cross-references.
 */
async function improveJupytextTables(
  options: RunImproveJupytextTablesOptions,
): Promise<void> {
  const articlePath = path.resolve(options.cwd, options.article || DEFAULT_ARTICLE);
  if (!fs.existsSync(articlePath)) {
    throw new Error(`Article not found: ${articlePath}`);
  }

  const content = readUtf8(articlePath);
  const { content: newContent, tableNumToLabel } = processArticle(content);

  if (newContent === content) {
    process.stdout.write('No table regions found; no changes.\n');
    return;
  }

  writeUtf8(articlePath, newContent, options.dryRun);
  process.stdout.write(
    options.dryRun
      ? '[dry-run] Would update article: ' +
          Array.from(tableNumToLabel.entries())
            .map(([n, l]) => `Table ${n} -> ${l}`)
            .join(', ') +
          '\n'
      : 'Updated article: converted ' +
          tableNumToLabel.size +
          ' table region(s) and updated refs.\n',
  );
}

/**
 * Wrap jupytext table `#region` blocks in MyST `{jdh-table}` directives and
 * normalize cross-references to `:label:` anchors.
 */
export const improveJupytextTablesStep: PipelineStep = {
  id: 'improveJupytextTables',
  label: 'Improve Jupytext tables (jdh-table directives)',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await improveJupytextTables({
      article: 'article.md',
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
