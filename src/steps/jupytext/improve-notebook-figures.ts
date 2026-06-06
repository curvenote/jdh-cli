import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';


const DEFAULT_ARTICLE = 'article.md';

/** Tag is a figure tag if it matches fig:N or figure-<N>-* or figure_<N> (after normalization we use fig:N) */
const FIGURE_TAG_PATTERN = /^(fig:\d+|figure[-_]?\d+[-_]?\*?)$/i;

interface RunImproveNotebookFiguresOptions {
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

/** Parse tags from opening line of code block, e.g. tags=["figure-1-*", "figure_1"] */
function parseTagsFromFenceLine(line: string): string[] {
  const match = line.match(/tags\s*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  const inner = match[1];
  const tags: string[] = [];
  const re = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) tags.push(m[1]);
  return tags;
}

/** Return first tag that matches figure-n / figure_n / fig:n; prefer fig:N (normalized) if present */
function firstFigureTag(tags: string[]): string | null {
  const normalized = tags.find((t) => /^fig:\d+$/i.test(t));
  if (normalized) return normalized;
  for (const t of tags) {
    if (FIGURE_TAG_PATTERN.test(t)) return t;
  }
  return null;
}

/** Extract figure number from tag (e.g. fig:1 -> 1, figure-1-* -> 1, figure_2 -> 2) */
function figureNumberFromTag(tag: string): number | null {
  const m = tag.match(/(?:^fig:(\d+)$|figure[-_]?(\d+))/i);
  return m ? parseInt(m[1] ?? m[2], 10) : null;
}

/** Extract image path from last line like display(Image("./media/figure1.png", width=1000), metadata=metadata) */
function extractImagePath(code: string): string | null {
  const match = code.match(/display\s*\(\s*Image\s*\(\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

/** Extract caption from metadata dict: jdh.object.source[0] (first string in source array) */
function extractCaptionFromCode(code: string): string | null {
  const match = code.match(/"source"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\"/g, '"') : null;
}

/** Escape backticks in caption for directive body */
function escapeCaption(s: string): string {
  return s.replace(/`/g, '\\`');
}

/** Strip "Figure N." or "Figure N:" from caption for directive (numbering is automatic). */
function stripFigureNumberPrefix(caption: string): string {
  return caption.replace(/^Figure\s+\d+[.:]\s*/i, '').trim();
}

/**
 * Normalize figure-n-* tags to fig:n (only in tags=[], :label:, and [](#...); not in code block bodies / metadata).
 */
function normalizeFigureTags(content: string): string {
  let result = content;
  result = result.replace(/\[\]\(#figure-(\d+)-\*\)/g, '[](#fig:$1)');
  result = result.replace(/(:label:\s*)figure-(\d+)-\*/g, '$1fig:$2');
  result = result.replace(/tags=\[([^\]]*?)\]/g, (match: string, inner: string) => {
    const newInner = inner.replace(/"figure-(\d+)-\*"/g, '"fig:$1"');
    return newInner !== inner ? 'tags=[' + newInner + ']' : match;
  });
  return result;
}

/**
 * Process article: normalize figure-n-* -> fig:n, then replace figure-tagged Python blocks and update refs.
 */
export function processArticle(content: string): { content: string; figureNumToLabel: Map<number, string> } {
  const figureNumToLabel = new Map<number, string>();

  content = normalizeFigureTags(content);

  const fenceRe = /^```(\w+)\s*(.*)$/gm;
  let result = content;
  let match: RegExpExecArray | null;

  const blocks: {
    start: number;
    end: number;
    lang: string;
    tagLine: string;
    body: string;
    fullMatch: string;
  }[] = [];
  while ((match = fenceRe.exec(content)) !== null) {
    const openStart = match.index;
    const lang = match[1];
    const tagLine = match[2];
    const openEnd = openStart + match[0].length;
    const afterOpen = content.slice(openEnd);
    const closeIdx = afterOpen.indexOf('\n```');
    if (closeIdx === -1) continue;
    const body = afterOpen.slice(0, closeIdx).replace(/^\n/, '');
    const closeStart = openEnd + closeIdx;
    const closeLine = content.slice(closeStart, content.indexOf('\n', closeStart) + 1 || content.length);
    const fullMatch = content.slice(openStart, closeStart + closeLine.length);

    if (lang === 'python') {
      const tags = parseTagsFromFenceLine(tagLine);
      const figureTag = firstFigureTag(tags);
      if (figureTag) {
        const num = figureNumberFromTag(figureTag);
        if (num != null) figureNumToLabel.set(num, figureTag);
        const imagePath = extractImagePath(body);
        const caption = extractCaptionFromCode(body);
        if (imagePath && caption != null) {
          blocks.push({
            start: openStart,
            end: openStart + fullMatch.length,
            lang,
            tagLine,
            body,
            fullMatch,
          });
        }
      }
    }
  }

  blocks.sort((a, b) => b.start - a.start);
  for (const b of blocks) {
    const tags = parseTagsFromFenceLine(b.tagLine);
    const figureTag = firstFigureTag(tags)!;
    const num = figureNumberFromTag(figureTag);
    if (num != null) figureNumToLabel.set(num, figureTag);
    const imagePath = extractImagePath(b.body)!;
    const captionRaw = extractCaptionFromCode(b.body)!;
    const caption = stripFigureNumberPrefix(captionRaw);
    const replacement = [
      '```{figure} ' + imagePath,
      `:label: ${figureTag}`,
      '',
      escapeCaption(caption),
      '```',
    ].join('\n');

    result = result.slice(0, b.start) + replacement + result.slice(b.end);
  }

  if (figureNumToLabel.size === 0) {
    const existingFigureRe = /```\s*\{figure\}[^\n]+\n:label:\s*([^\s\n]+)/g;
    let em: RegExpExecArray | null;
    while ((em = existingFigureRe.exec(result)) !== null) {
      const label = em[1];
      const num = figureNumberFromTag(label);
      if (num != null) figureNumToLabel.set(num, label);
    }
  }

  const skipRanges: { start: number; end: number }[] = [];
  let dm: RegExpExecArray | null;
  const codeBlockRe = /^```[\s\S]*?^```/gm;
  while ((dm = codeBlockRe.exec(result)) !== null) {
    skipRanges.push({ start: dm.index, end: dm.index + dm[0].length });
  }
  skipRanges.sort((a, b) => a.start - b.start);
  function inSkip(idx: number): boolean {
    return skipRanges.some((s) => idx >= s.start && idx < s.end);
  }

  for (const [num, label] of figureNumToLabel) {
    const linkPattern = new RegExp(`\\[Figure\\s+${num}\\]\\(#[^)]*\\)`, 'gi');
    result = result.replace(linkPattern, (match: string, offset: number) => {
      if (inSkip(offset)) return match;
      return '[](#' + label + ')';
    });
    const refLiteral = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('\\{ref\\}`' + refLiteral + '`', 'g'), (match: string, offset: number) => {
      if (inSkip(offset)) return match;
      return '[](#' + label + ')';
    });
    const oldStyleRef = new RegExp('\\{ref\\}`figure-' + num + '-\\*`', 'g');
    result = result.replace(oldStyleRef, (match: string, offset: number) => {
      if (inSkip(offset)) return match;
      return '[](#' + label + ')';
    });
  }

  for (const [num, label] of figureNumToLabel) {
    const re = new RegExp('(^|[^\\w{(#`])Figure\\s+' + num + '\\b([^\\w}]|$)', 'gi');
    result = result.replace(re, (match: string, before: string, after: string, offset: number) => {
      if (inSkip(offset)) return match;
      return before + '[](#' + label + ')' + after;
    });
  }

  result = result.replace(
    /(```\s*\{figure\}[^\n]+\n:label: [^\n]+\n\n)Figure\s+\d+[.:]\s*/gi,
    '$1',
  );

  return { content: result, figureNumToLabel };
}

/**
 * Detects Python code cells tagged as figures, converts them to MyST `{figure}`
 * directives (figure source code is omitted from the workdir — see hide-figure-code
 * plugin and docs/plugins.md), and updates figure references in the article.
 */
async function improveNotebookFigures(
  options: RunImproveNotebookFiguresOptions,
): Promise<void> {
  const articlePath = path.resolve(options.cwd, options.article || DEFAULT_ARTICLE);
  if (!fs.existsSync(articlePath)) {
    throw new Error(`Article not found: ${articlePath}`);
  }

  const content = readUtf8(articlePath);
  const { content: newContent, figureNumToLabel } = processArticle(content);

  if (newContent === content) {
    process.stdout.write('No figure-tagged Python blocks found; no changes.\n');
    return;
  }

  writeUtf8(articlePath, newContent, options.dryRun);
  process.stdout.write(
    options.dryRun
      ? '[dry-run] Would update article: ' +
          Array.from(figureNumToLabel.entries())
            .map(([n, l]) => `Figure ${n} -> ${l}`)
            .join(', ') +
          '\n'
      : 'Updated article: converted ' +
          figureNumToLabel.size +
          ' figure block(s) and updated refs.\n',
  );
}

/**
 * Convert figure-tagged Python code cells to MyST `{figure}` directives and update
 * figure cross-references. Figure display code is not written to the workdir.
 */
export const improveNotebookFiguresStep: PipelineStep = {
  id: 'improveNotebookFigures',
  label: 'Improve notebook figures (figure directives)',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await improveNotebookFigures({
      article: 'article.md',
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
