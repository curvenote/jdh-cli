import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';


const DEFAULT_ARTICLE = 'article.md';
const TARGET_TAG = 'hermeneutics';

interface RunImproveHermeneuticsBlocksOptions {
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

/**
 * Parse the `tags=[...]` attribute from an attribute string (the part between
 * `<!-- #region` and `-->`, or after `` ```python ``).
 */
function parseTagsFromAttrs(attrs: string): string[] {
  const m = attrs.match(/tags\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  const inner = m[1];
  const tags: string[] = [];
  const re = /["']([^"']+)["']/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(inner)) !== null) tags.push(mm[1]);
  return tags;
}

/**
 * Rewrite a `tags=["foo", "hermeneutics", "bar"]` attribute string by removing
 * the `hermeneutics` entry while preserving the original quote style of every
 * surviving entry.
 */
function stripHermeneuticsFromTagsAttr(tagsAttr: string): string {
  const m = tagsAttr.match(/^(tags\s*=\s*\[)([^\]]*)(\])$/);
  if (!m) return tagsAttr;
  const [, prefix, inner, suffix] = m;
  const rawEntries = inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const kept = rawEntries.filter((entry) => {
    const q = entry.match(/^["']([^"']+)["']$/);
    if (!q) return true;
    return q[1] !== TARGET_TAG;
  });
  if (kept.length === 0) return '';
  return `${prefix}${kept.join(', ')}${suffix}`;
}

/**
 * Walk fenced code blocks inside the inner content of a (soon-to-be) wrapped
 * hermeneutics block and strip the now-redundant `hermeneutics` tag from
 * each opening fence's `tags=[...]` attribute.
 */
function stripHermeneuticsTagFromInnerCodeFences(inner: string): string {
  const lines = inner.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const open = line.match(
        /^```([A-Za-z0-9_+-]+)\b(?:\s+(tags\s*=\s*\[[^\]]*\]))?\s*$/,
      );
      if (open) {
        const lang = open[1];
        const tagsAttr = open[2];
        if (tagsAttr) {
          const tags = parseTagsFromAttrs(tagsAttr);
          if (tags.includes(TARGET_TAG)) {
            const stripped = stripHermeneuticsFromTagsAttr(tagsAttr);
            lines[i] = stripped ? `\`\`\`${lang} ${stripped}` : `\`\`\`${lang}`;
          }
        }
        inFence = true;
        continue;
      }
    } else if (/^```\s*$/.test(line)) {
      inFence = false;
    }
  }
  return lines.join('\n');
}

type RegionRange = { start: number; end: number };

/**
 * Build character ranges for every existing `:::{hermeneutics} ... :::` directive.
 * Also matches legacy `:::{block} hermeneutics ... :::` for idempotency.
 */
function findExistingHermeneuticsBlocks(content: string): RegionRange[] {
  const ranges: RegionRange[] = [];
  const patterns = [
    /:::\s*\{hermeneutics\}[\s\S]*?\n:::\s*$/gm,
    /:::\s*\{block\}\s+hermeneutics\b[\s\S]*?\n:::\s*$/gm,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return ranges;
}

type Match =
  | { kind: 'region'; start: number; end: number; inner: string }
  | { kind: 'code'; start: number; end: number; inner: string };

function findHermeneuticsRegions(content: string): Match[] {
  const out: Match[] = [];
  const openRe = /^<!--\s*#region([^>\n]*?)-->[ \t]*$/gm;
  const closeRe = /<!--\s*#endregion\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(content)) !== null) {
    const attrs = m[1];
    if (!parseTagsFromAttrs(attrs).includes(TARGET_TAG)) continue;
    const openStart = m.index;
    const openEnd = m.index + m[0].length;
    closeRe.lastIndex = openEnd;
    const close = closeRe.exec(content);
    if (!close) continue;
    const inner = content.slice(openEnd, close.index).replace(/^\n+|\n+$/g, '');
    out.push({
      kind: 'region',
      start: openStart,
      end: close.index + close[0].length,
      inner,
    });
  }
  return out;
}

function findHermeneuticsCodeFences(content: string): Match[] {
  const out: Match[] = [];
  const lines = content.split('\n');

  const lineStarts: number[] = new Array(lines.length + 1);
  lineStarts[0] = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i + 1] = lineStarts[i] + lines[i].length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^```([A-Za-z0-9_+-]+)\b\s+(tags\s*=\s*\[[^\]]*\])\s*$/);
    if (!fenceMatch) continue;
    const tags = parseTagsFromAttrs(fenceMatch[2]);
    if (!tags.includes(TARGET_TAG)) continue;

    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^```\s*$/.test(lines[j])) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx === -1) continue;

    const start = lineStarts[i];
    const end = lineStarts[closeIdx] + lines[closeIdx].length;
    const inner = lines.slice(i, closeIdx + 1).join('\n');

    out.push({ kind: 'code', start, end, inner });
    i = closeIdx;
  }

  return out;
}

function isInside(range: RegionRange, ranges: RegionRange[]): boolean {
  return ranges.some((r) => range.start >= r.start && range.end <= r.end);
}

type ProcessResult = {
  content: string;
  regionsConverted: number;
  codeBlocksWrapped: number;
};

export function processArticle(content: string): ProcessResult {
  const regions = findHermeneuticsRegions(content);
  const codeFences = findHermeneuticsCodeFences(content);
  const existingBlocks = findExistingHermeneuticsBlocks(content);

  const regionRanges: RegionRange[] = regions.map((r) => ({ start: r.start, end: r.end }));

  const filteredCodeFences = codeFences.filter((c) => {
    if (isInside({ start: c.start, end: c.end }, regionRanges)) return false;
    if (isInside({ start: c.start, end: c.end }, existingBlocks)) return false;
    return true;
  });

  const allMatches: Match[] = [...regions, ...filteredCodeFences];
  if (allMatches.length === 0) {
    return { content, regionsConverted: 0, codeBlocksWrapped: 0 };
  }

  allMatches.sort((a, b) => b.start - a.start);

  let result = content;
  for (const m of allMatches) {
    const cleanedInner = stripHermeneuticsTagFromInnerCodeFences(m.inner);
    const replacement = [':::{hermeneutics}', '', cleanedInner, ':::'].join('\n');
    result = result.slice(0, m.start) + replacement + result.slice(m.end);
  }

  return {
    content: result,
    regionsConverted: regions.length,
    codeBlocksWrapped: filteredCodeFences.length,
  };
}

/**
 * Wraps Jupytext content tagged `hermeneutics` in MyST `:::{hermeneutics}` directives.
 */
async function improveHermeneuticsBlocks(
  options: RunImproveHermeneuticsBlocksOptions,
): Promise<void> {
  const articlePath = path.resolve(options.cwd, options.article || DEFAULT_ARTICLE);
  if (!fs.existsSync(articlePath)) {
    throw new Error(`Article not found: ${articlePath}`);
  }

  const content = readUtf8(articlePath);
  const { content: newContent, regionsConverted, codeBlocksWrapped } = processArticle(content);

  if (newContent === content) {
    process.stdout.write('No hermeneutics regions or fenced code cells found; no changes.\n');
    return;
  }

  writeUtf8(articlePath, newContent, options.dryRun);

  process.stdout.write(
    [
      options.dryRun ? '[dry-run] Would update article.' : 'Updated article.',
      `- Regions wrapped:    ${regionsConverted}`,
      `- Code cells wrapped: ${codeBlocksWrapped}`,
      `- Total :::{hermeneutics} directives written: ${regionsConverted + codeBlocksWrapped}`,
    ].join('\n') + '\n',
  );
}

/**
 * Wrap jupytext regions and fenced cells tagged `hermeneutics` in MyST
 * `:::{hermeneutics}` directives.
 */
export const improveHermeneuticsBlocksStep: PipelineStep = {
  id: 'improveHermeneuticsBlocks',
  label: 'Improve hermeneutics blocks (:::{hermeneutics} directives)',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await improveHermeneuticsBlocks({
      article: 'article.md',
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
