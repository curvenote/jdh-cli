import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { partitionPartsByKind, removeBodyLineIntervals } from '../shared/myst-parts.js';
import { parseMarkdownFrontmatter, stringifyMarkdownFrontmatter } from '../shared/yaml-doc.js';

/** Parts to extract from jupytext `#region` tags. */
const EXPECTED_PART_TAGS: string[] = ['abstract', 'copyright'];

interface RunExtractJupytextPartsOptions {
  article?: string;
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

/** Parse `tags=[...]` from a jupytext `<!-- #region ... -->` comment line. */
function parseTagsFromRegionLine(line: string): string[] {
  const m = line.match(/tags\s*=\s*(\[[^\]]*\])/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function findTaggedRegions(
  lines: string[],
  tag: string,
): Array<{ start: number; end: number; content: string }> {
  const found: Array<{ start: number; end: number; content: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('<!--') || !line.includes('#region')) continue;
    const tags = parseTagsFromRegionLine(line);
    if (!tags.includes(tag)) continue;

    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes('#endregion')) {
        const content = lines.slice(i + 1, j).join('\n').trim();
        found.push({ start: i, end: j, content });
        i = j;
        break;
      }
    }
  }

  return found;
}

async function extractJupytextParts(options: RunExtractJupytextPartsOptions): Promise<void> {
  const articlePath = path.resolve(options.cwd, options.article ?? 'article.md');

  const md = readUtf8(articlePath);
  const { doc, body } = parseMarkdownFrontmatter(md);
  const bodyLines = body.split('\n');

  const rawParts: Record<string, string> = {};
  const intervalsToRemove: Array<{ start: number; end: number }> = [];

  for (const partTag of EXPECTED_PART_TAGS) {
    const regions = findTaggedRegions(bodyLines, partTag);
    if (!regions.length) continue;

    const content = regions
      .map((r) => r.content)
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!content) continue;

    rawParts[partTag] = content;
    for (const r of regions) intervalsToRemove.push({ start: r.start, end: r.end });
  }

  const extractedCount = Object.keys(rawParts).length;
  if (extractedCount === 0) {
    process.stdout.write('Done. No matching jupytext part regions found; no changes.\n');
    return;
  }

  const { knownParts, customParts } = partitionPartsByKind(rawParts);
  const newBodyLines = removeBodyLineIntervals(bodyLines, intervalsToRemove);

  // Known parts may also sit at the root of the frontmatter; keep one copy, under `parts`.
  for (const key of Object.keys(knownParts)) doc.delete(key);
  for (const [key, content] of Object.entries({ ...knownParts, ...customParts })) {
    doc.setIn(['parts', key], content);
  }

  const newMd = stringifyMarkdownFrontmatter({ doc, body: newBodyLines.join('\n') });
  const changed = newMd !== md;
  if (changed) writeUtf8(articlePath, newMd, options.dryRun);

  process.stdout.write(
    [
      'Done.',
      `- Article: ${path.relative(options.cwd, articlePath)}`,
      `- Extracted parts: ${extractedCount}`,
      Object.keys(knownParts).length ? `- Known parts: ${Object.keys(knownParts).join(', ')}` : null,
      Object.keys(customParts).length ? `- Custom parts: ${Object.keys(customParts).join(', ')}` : null,
      changed ? `- Updated: ${path.relative(options.cwd, articlePath)}` : '- No changes needed',
      options.dryRun ? '(dry-run: no files written)' : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

/**
 * Move abstract, copyright, and other jupytext `#region`-tagged blocks from the
 * article body into page YAML frontmatter, then strip the regions from markdown.
 */
export const extractJupytextPartsStep: PipelineStep = {
  id: 'extractJupytextParts',
  label: 'Extract jupytext document parts → page frontmatter',
  inputs: ['markdown', 'frontmatter'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await extractJupytextParts({
      article: 'article.md',
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
