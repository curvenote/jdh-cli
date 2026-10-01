import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import {
  captionFromCode,
  captionFromJdh,
  figureLabelFromTag,
  indexFiguresByLabel,
  kindFromTags,
  loadNotebook,
  parseFenceMetadata,
  readTaggedCells,
  resolveCaption,
  type TaggedCell,
} from '../shared/notebook-cells.js';

const DEFAULT_ARTICLE = 'article.md';
const DEFAULT_NOTEBOOK = 'article.ipynb';

/** A figure tag in the forms JDH authors use: fig:…, figure-1-*, figure_1, figure-cartoon-* */
const FIGURE_TAG_TOKEN = 'figure[-_][A-Za-z0-9][A-Za-z0-9_-]*(?:-\\*)?';

interface RunImproveNotebookFiguresOptions {
  article: string;
  notebook?: string;
  /** Article repo root, to copy images that live outside the workdir's copied folders. */
  projectRoot?: string;
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

/** First figure tag as a MyST label (fig:…), or null when the cell is not a figure. */
function firstFigureTag(tags: string[]): string | null {
  const normalized = tags.find((t) => /^fig:/i.test(t));
  if (normalized) return normalized;
  const found = kindFromTags(tags);
  return found?.kind === 'figure' ? figureLabelFromTag(found.tag) : null;
}

/** Extract figure number from tag (e.g. fig:1 -> 1, figure-1-* -> 1, figure_2 -> 2) */
function figureNumberFromTag(tag: string): number | null {
  const m = tag.match(/(?:^fig:(\d+)$|figure[-_]?(\d+))/i);
  return m ? parseInt(m[1] ?? m[2], 10) : null;
}

/** Extract image path from a line like display(Image("./media/figure1.png", width=1000), metadata=metadata) */
function extractImagePath(code: string): string | null {
  const match = code.match(/\bImage\s*\(\s*(?:filename\s*=\s*)?["']([^"']+)["']/);
  return match ? match[1] : null;
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
 * Normalize figure tags (figure-1-*, figure-cartoon-*) to fig:… labels in tags=[],
 * :label:, link targets and {ref} roles; not in code block bodies / metadata.
 */
function normalizeFigureTags(content: string): string {
  const token = new RegExp(`^${FIGURE_TAG_TOKEN}$`, 'i');
  let result = content;
  result = result.replace(
    new RegExp(`\\]\\(#(${FIGURE_TAG_TOKEN})\\)`, 'gi'),
    (_m: string, tag: string) => `](#${figureLabelFromTag(tag)})`,
  );
  result = result.replace(
    new RegExp(`\\{ref\\}\`(${FIGURE_TAG_TOKEN})\``, 'gi'),
    (_m: string, tag: string) => `[](#${figureLabelFromTag(tag)})`,
  );
  result = result.replace(
    new RegExp(`(:label:\\s*)(${FIGURE_TAG_TOKEN})`, 'gi'),
    (_m: string, prefix: string, tag: string) => prefix + figureLabelFromTag(tag),
  );
  result = result.replace(/tags=\[([^\]]*?)\]/g, (match: string, inner: string) => {
    const newInner = inner.replace(/"([^"]+)"/g, (q: string, tag: string) =>
      token.test(tag) ? `"${figureLabelFromTag(tag)}"` : q,
    );
    return newInner !== inner ? 'tags=[' + newInner + ']' : match;
  });
  return result;
}

export interface FigureReport {
  converted: string[];
  /** Figure cells left as code, with the reason (e.g. no image file: needs notebook output). */
  skipped: { label: string; reason: string }[];
  /** Figures whose caption differs between code, cell metadata and notebook output. */
  captionConflicts: { label: string; used: string; others: string[] }[];
}

/**
 * Process article: normalize figure-n-* -> fig:n, then replace figure-tagged Python blocks and update refs.
 */
export function processArticle(
  content: string,
  notebookCells: readonly TaggedCell[] = [],
  /** Returns false when an image file can't be made available; the cell then stays as code. */
  ensureImage: (imagePath: string) => boolean = () => true,
): { content: string; figureNumToLabel: Map<number, string>; report: FigureReport } {
  const figureNumToLabel = new Map<number, string>();
  const report: FigureReport = { converted: [], skipped: [], captionConflicts: [] };
  const notebookFigures = indexFiguresByLabel(notebookCells);
  const captionFor = new Map<number, string>();

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
    // closeStart is the newline before the closing fence; include the whole fence line.
    const lineEnd = content.indexOf('\n', closeStart + 1);
    const fullMatch = content.slice(openStart, lineEnd === -1 ? content.length : lineEnd);

    if (lang === 'python') {
      const tags = parseTagsFromFenceLine(tagLine);
      const figureTag = firstFigureTag(tags);
      if (figureTag) {
        const num = figureNumberFromTag(figureTag);
        if (num != null) figureNumToLabel.set(num, figureTag);
        const nbCell = notebookFigures.get(figureTag);
        const captions = {
          code: captionFromCode(body),
          cell: captionFromJdh(parseFenceMetadata(tagLine, 'jdh')) ?? nbCell?.captions.cell ?? null,
          output: nbCell?.captions.output ?? null,
        };
        const resolved = resolveCaption(captions);
        if (resolved.conflict) {
          report.captionConflicts.push({
            label: figureTag,
            used: resolved.from!,
            others: (['code', 'cell', 'output'] as const).filter((k) => k !== resolved.from && captions[k]),
          });
        }
        const imagePath = extractImagePath(body);
        const mimes = nbCell?.outputs.map((o) => o.mime) ?? [];
        const outputNote = mimes.length ? `; notebook output ${mimes.join(', ')}` : nbCell ? '; no notebook output' : '';
        const reason = !imagePath
          ? `no image file in code${outputNote}`
          : resolved.text == null
            ? 'no caption in code, cell metadata or notebook output'
            : !ensureImage(imagePath)
              ? `image file ${imagePath} not found${outputNote}`
              : null;
        if (reason) {
          report.skipped.push({ label: figureTag, reason });
        } else {
          captionFor.set(openStart, resolved.text!);
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
    const caption = stripFigureNumberPrefix(captionFor.get(b.start)!);
    report.converted.unshift(figureTag);
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
    // Legacy figure code-block labels (Option B no longer emits code:fig:* nodes).
    const codeFigLabel = `code:${label}`;
    const codeFigLiteral = codeFigLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp('\\[\\]\\(#' + codeFigLiteral + '\\)', 'g'),
      (match: string, offset: number) => {
        if (inSkip(offset)) return match;
        return '[](#' + label + ')';
      },
    );
    result = result.replace(
      new RegExp('\\{ref\\}`' + codeFigLiteral + '`', 'g'),
      (match: string, offset: number) => {
        if (inSkip(offset)) return match;
        return '[](#' + label + ')';
      },
    );
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

  return { content: result, figureNumToLabel, report };
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

  const notebook = loadNotebook(path.resolve(options.cwd, options.notebook || DEFAULT_NOTEBOOK));
  const notebookCells = notebook ? readTaggedCells(notebook) : [];
  if (!notebook) process.stdout.write('No article.ipynb in workdir; using article.md only.\n');

  const ensureImage = (imagePath: string): boolean => {
    if (/^[a-z]+:\/\//i.test(imagePath)) return true;
    const inWorkdir = path.resolve(options.cwd, imagePath);
    if (fs.existsSync(inWorkdir)) return true;
    // Images saved next to the notebook (not under media/) are not copied by prepareWorkdir.
    const inProject = options.projectRoot ? path.resolve(options.projectRoot, imagePath) : null;
    if (!inProject || !fs.existsSync(inProject)) return false;
    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(inWorkdir), { recursive: true });
      fs.copyFileSync(inProject, inWorkdir);
    }
    process.stdout.write(`  - copy     ${imagePath}\n`);
    return true;
  };

  const content = readUtf8(articlePath);
  const { content: newContent, report } = processArticle(content, notebookCells, ensureImage);

  for (const c of report.captionConflicts) {
    process.stdout.write(
      `Warning: ${c.label} caption differs between ${[c.used, ...c.others].join(', ')}; using ${c.used}.\n`,
    );
  }
  for (const s of report.skipped) {
    process.stdout.write(`Left as code: ${s.label} (${s.reason}).\n`);
  }

  if (newContent === content) {
    process.stdout.write('No figure-tagged Python blocks converted; no changes.\n');
    return;
  }

  writeUtf8(articlePath, newContent, options.dryRun);
  process.stdout.write(
    `${options.dryRun ? '[dry-run] Would convert' : 'Converted'} ${report.converted.length} figure block(s)` +
      (report.converted.length ? `: ${report.converted.join(', ')}` : '') +
      ' and updated refs.\n',
  );
}

/**
 * Convert figure-tagged Python code cells to MyST `{figure}` directives and update
 * figure cross-references. Figure display code is not written to the workdir.
 */
export const improveNotebookFiguresStep: PipelineStep = {
  id: 'improveNotebookFigures',
  label: 'Improve notebook figures (figure directives)',
  inputs: ['markdown', 'ipynb'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await improveNotebookFigures({
      article: 'article.md',
      notebook: 'article.ipynb',
      projectRoot: o.projectRoot,
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
