import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveBundledPlaceholder } from '../../init/bundled-assets.js';
import { articleUrl, resolveArticleId } from '../common/set-jdh-article-metadata.js';
import {
  captionFromCode,
  captionFromJdh,
  figureLabelFromTag,
  indexFiguresByLabel,
  kindFromTags,
  loadNotebook,
  videoLabelFromTag,
  parseFenceMetadata,
  readTaggedCells,
  resolveCaption,
  type TaggedCell,
} from '../shared/notebook-cells.js';

const DEFAULT_ARTICLE = 'article.md';
const DEFAULT_NOTEBOOK = 'article.ipynb';
/** Image format Typst can read, from the file's magic bytes; null for anything else (e.g. WebP). */
export function imageFormat(bytes: Buffer): 'png' | 'jpg' | 'gif' | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  return null;
}

/** The article's JDH page from the repo name, or null when the id can't be determined. */
function jdhArticleUrl(projectRoot: string): string | null {
  const id = resolveArticleId(projectRoot);
  return id ? articleUrl(id) : null;
}

/** Workdir folder for figure images decoded from notebook outputs. */
const OUTPUTS_DIR = 'notebook-outputs';
/** Outputs that only work in a browser; shown in the PDF as a placeholder. */
const INTERACTIVE_MIME = /^(text\/html|application\/(javascript|vnd\.plotly|vnd\.bokehjs|vnd\.jupyter\.widget))/;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** A figure tag in the forms JDH authors use: fig:…, figure-1-*, figure_1, figure-cartoon-* */
const FIGURE_TAG_TOKEN = 'figure[-_][A-Za-z0-9][A-Za-z0-9_-]*(?:-\\*)?';

interface RunImproveNotebookFiguresOptions {
  article: string;
  notebook?: string;
  /** Article repo root, to copy images that live outside the workdir's copied folders. */
  projectRoot?: string;
  /** Online article page; placeholders link to `<articleUrl>?idx=<cell index>`. */
  articleUrl?: string | null;
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

/** First figure or video tag as a MyST label (fig:…, vid:…), or null for other cells. */
function firstFigureTag(tags: string[]): string | null {
  const normalized = tags.find((t) => /^(fig|vid):/i.test(t));
  if (normalized) return normalized;
  const found = kindFromTags(tags);
  if (found?.kind === 'figure') return figureLabelFromTag(found.tag);
  if (found?.kind === 'video') return videoLabelFromTag(found.tag);
  return null;
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

export interface ImageRequest {
  label: string;
  kind: 'figure' | 'video';
  /** Image file the cell's code displays, if any. */
  imagePath: string | null;
  cell?: TaggedCell;
}

export interface ResolvedImage {
  path: string;
  /** `placeholder`: the figure only exists online (interactive chart, video). */
  from: 'file' | 'output' | 'placeholder';
  /** Link to the online version, added to the caption of placeholders. */
  link?: string;
}

export interface FigureReport {
  converted: string[];
  /** Figures whose image came from the notebook output rather than a file. */
  fromOutput: string[];
  /** Figures shown as a placeholder (interactive or video output with no image). */
  placeholders: string[];
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
  /**
   * Choose the figure image: the file the code displays when available, else the
   * cell's image output. Returns null when neither exists; the cell then stays as code.
   */
  resolveImage: (req: ImageRequest) => ResolvedImage | null = ({ imagePath }) =>
    imagePath ? { path: imagePath, from: 'file' } : null,
): { content: string; figureNumToLabel: Map<number, string>; report: FigureReport } {
  const figureNumToLabel = new Map<number, string>();
  const report: FigureReport = { converted: [], fromOutput: [], placeholders: [], skipped: [], captionConflicts: [] };
  const notebookFigures = indexFiguresByLabel(notebookCells);
  const captionFor = new Map<number, string>();
  const imageFor = new Map<number, string>();
  const linkFor = new Map<number, string>();

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
        const image =
          resolved.text == null
            ? null
            : resolveImage({
                label: figureTag,
                kind: figureTag.startsWith('vid:') ? 'video' : 'figure',
                imagePath,
                cell: nbCell,
              });
        const reason =
          resolved.text == null
            ? 'no caption in code, cell metadata or notebook output'
            : !image
              ? imagePath
                ? `image file ${imagePath} not found${outputNote}`
                : `no image file in code${outputNote}`
              : null;
        if (reason || !image) {
          report.skipped.push({ label: figureTag, reason: reason! });
        } else {
          captionFor.set(openStart, resolved.text!);
          imageFor.set(openStart, image.path);
          if (image.link) linkFor.set(openStart, image.link);
          if (image.from === 'output') report.fromOutput.push(figureTag);
          if (image.from === 'placeholder') report.placeholders.push(figureTag);
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
    const imagePath = imageFor.get(b.start)!;
    const link = linkFor.get(b.start);
    const text = stripFigureNumberPrefix(captionFor.get(b.start)!);
    const caption = link
      ? `${text}${/[.!?:]$/.test(text) ? '' : '.'} [View it in the online article.](${link})`
      : text;
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

  const ensureFile = (imagePath: string): boolean => {
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

  const placeholder = (variant: 'interactive' | 'video' | 'figure', cell?: TaggedCell): ResolvedImage => {
    const rel = `${OUTPUTS_DIR}/placeholder-${variant}.svg`;
    if (!options.dryRun) {
      const dest = path.resolve(options.cwd, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(resolveBundledPlaceholder(variant), dest);
    }
    // The JDH site opens a notebook cell with ?idx=<cell index>.
    const link = options.articleUrl && cell ? `${options.articleUrl}?idx=${cell.index}` : undefined;
    return { path: rel, from: 'placeholder', link };
  };

  const resolveImage = ({ label, kind, imagePath, cell }: ImageRequest): ResolvedImage | null => {
    if (imagePath && ensureFile(imagePath)) return { path: imagePath, from: 'file' };
    const images = cell?.outputs.filter((o) => o.mime in IMAGE_EXTENSIONS) ?? [];
    if (!images.length) {
      if (kind === 'video') return placeholder('video', cell);
      const outputs = cell?.outputs ?? [];
      // Dataframe tables are left for the table step (JDH-003), not hidden behind a placeholder.
      if (outputs.some((o) => o.mime === 'text/html' && /<table/i.test(o.data))) return null;
      if (outputs.some((o) => INTERACTIVE_MIME.test(o.mime))) return placeholder('interactive', cell);
      return null;
    }
    if (images.length > 1) {
      process.stdout.write(`Note: ${label} has ${images.length} image outputs; using the first usable one.\n`);
    }
    for (const { mime, data } of images) {
      // SVG outputs are text; the others are base64 (possibly split over lines).
      const bytes = mime === 'image/svg+xml' ? Buffer.from(data) : Buffer.from(data.replace(/\s+/g, ''), 'base64');
      // Trust the bytes, not the MIME label: some "image/png" outputs are WebP, which Typst can't read.
      const ext = mime === 'image/svg+xml' ? 'svg' : imageFormat(bytes);
      if (!ext) {
        process.stdout.write(`Note: ${label} ${mime} output isn't PNG, JPEG or GIF data; skipping it.\n`);
        continue;
      }
      const rel = `${OUTPUTS_DIR}/${label.replace(/[^A-Za-z0-9_-]+/g, '-')}.${ext}`;
      if (!options.dryRun) {
        const dest = path.resolve(options.cwd, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, bytes);
      }
      process.stdout.write(`  - write    ${rel} (${mime} output)\n`);
      return { path: rel, from: 'output' };
    }
    return placeholder('figure', cell);
  };

  const content = readUtf8(articlePath);
  const { content: newContent, report } = processArticle(content, notebookCells, resolveImage);

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
      ' and updated refs.' +
      (report.fromOutput.length ? ` From notebook output: ${report.fromOutput.join(', ')}.` : '') +
      (report.placeholders.length ? ` Placeholder (view online): ${report.placeholders.join(', ')}.` : '') +
      '\n',
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
      articleUrl: ctx.options.url ?? jdhArticleUrl(o.projectRoot),
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
