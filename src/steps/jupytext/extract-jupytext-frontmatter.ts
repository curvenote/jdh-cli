import fs from 'node:fs';
import path from 'node:path';
import type { Document } from 'yaml';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';
import { updateYamlFile } from '../shared/yaml-doc.js';

const DEFAULT_ARTICLE = 'article.md';
const DEFAULT_MYST = 'myst.yml';

interface RunExtractJupytextFrontmatterOptions {
  article?: string;
  myst?: string;
  dryRun: boolean;
  orcidLookup: boolean;
  cwd: string;
}

export interface Contributor {
  name: string | null;
  affiliationLines: string[];
  orcid: string | null;
  email: string | null;
}

export interface ExtractedFrontmatter {
  title: string | null;
  keywords: string[];
  /** One per `contributor` region (JDH notebooks have one cell per author), in order. */
  contributors: Contributor[];
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

/** Every `#region` tagged `tag`, in document order. */
function findTaggedRegions(lines: string[], tag: string): { content: string; start: number; end: number }[] {
  const regions: { content: string; start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('<!--') || !line.includes('#region')) continue;
    if (!parseTagsFromRegionLine(line).includes(tag)) continue;
    const j = lines.findIndex((l, k) => k > i && l.includes('#endregion'));
    if (j === -1) break;
    regions.push({ content: lines.slice(i + 1, j).join('\n').trim(), start: i, end: j });
    i = j;
  }
  return regions;
}

function findTaggedRegion(lines: string[], tag: string): { content: string; start: number; end: number } | null {
  return findTaggedRegions(lines, tag)[0] ?? null;
}

function parseTitle(content: string): string | null {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const first = lines[0].replace(/^#+\s*/, '').trim();
  return first || null;
}

function extractOrcidId(s: string): string | null {
  const m = s.match(/https?:\/\/orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b/i);
  return m?.[1] ?? null;
}

/** Strip MyST/Markdown ORCID badge links from an author name line. */
export function stripOrcidMarkdownFromName(name: string): string {
  return name
    .replace(/\s*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*orcid\.org\/[^)]*\)/gi, '')
    .trim();
}

const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Plain text for a contributor line: `C<sup>2</sup>DH` → `C²DH`, `<br/>` and other tags dropped. */
function cleanContributorLine(line: string): string {
  return line
    .replace(/<sup>(\d+)<\/sup>/gi, (_m, d: string) => [...d].map((c) => SUPERSCRIPT[c]).join(''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name (with ORCID badge) on the heading line; then email and affiliation lines. */
export function parseContributor(content: string): Contributor {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { name: null, affiliationLines: [], orcid: null, email: null };

  const header = lines[0];
  const orcid = extractOrcidId(header);

  let name = header.replace(/^#+\s*/, '').trim();
  name = stripOrcidMarkdownFromName(name);

  let email: string | null = null;
  const affiliationLines: string[] = [];
  for (const line of lines.slice(1).map(cleanContributorLine).filter(Boolean)) {
    if (!email && EMAIL_RE.test(line)) email = line;
    else affiliationLines.push(line);
  }

  return { name: name || null, affiliationLines, orcid, email };
}

function parseKeywords(content: string): string[] {
  const line = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  if (!line) return [];
  return line
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

async function fetchOrcidPerson(orcid: string): Promise<{ displayName?: string } | null> {
  const url = `https://pub.orcid.org/v3.0/${orcid}/person`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      name?: Record<string, { value?: string }>;
      person?: { name?: Record<string, { value?: string }> };
    };

    const name = json?.name ?? json?.person?.name;
    const credit = name?.['credit-name']?.value ? String(name['credit-name'].value) : null;
    const given = name?.['given-names']?.value ? String(name['given-names'].value) : null;
    const family = name?.['family-name']?.value ? String(name['family-name'].value) : null;

    const displayName = credit || (given && family ? `${given} ${family}` : null);
    return displayName ? { displayName } : null;
  } catch {
    return null;
  }
}

/** Set title, keywords and the authors in `project` of a myst.yml document. */
function setMystProjectFrontmatter(doc: Document, extracted: ExtractedFrontmatter): void {
  if (!doc.has('project')) throw new Error('Project config has no `project:` block');

  if (extracted.title) doc.setIn(['project', 'title'], extracted.title);
  if (extracted.keywords.length) doc.setIn(['project', 'keywords'], extracted.keywords);

  const authors = extracted.contributors
    .filter((c) => c.name)
    .map(({ name, orcid, email, affiliationLines }) => ({
      name,
      ...(orcid ? { orcid: `https://orcid.org/${orcid}` } : {}),
      ...(email ? { email } : {}),
      ...(affiliationLines.length ? { affiliations: affiliationLines } : {}),
    }));
  if (authors.length) doc.setIn(['project', 'authors'], authors);
}

function rewriteArticleMarkdown(md: string, extracted: ExtractedFrontmatter): string {
  const lines = md.split('\n');

  let yamlStart = -1;
  let yamlEnd = -1;
  if (lines[0] === '---') {
    yamlStart = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        yamlEnd = i;
        break;
      }
    }
  }

  const tagsToRemove = new Set(['title', 'contributor', 'keywords']);
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('<!--') && line.includes('#region') && line.includes('tags=')) {
      const tags = parseTagsFromRegionLine(line);
      const shouldRemove = tags.some((t) => tagsToRemove.has(t));
      if (shouldRemove) {
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('#endregion')) j++;
        i = j;
        continue;
      }
    }
    out.push(line);
  }

  const outLines = out;
  const title = extracted.title;
  if (title && yamlStart === 0 && yamlEnd !== -1) {
    const before = outLines.slice(0, yamlEnd + 1);
    const after = outLines.slice(yamlEnd + 1);

    while (after.length && after[0].trim() === '') after.shift();

    if (after.length && after[0].startsWith('# ')) {
      after[0] = `# ${title}`;
    } else {
      after.unshift(`# ${title}`);
    }

    return [...before, '', ...after].join('\n');
  }

  return outLines.join('\n');
}

/** Title, keywords and every contributor from the article's tagged regions. */
export function extractFrontmatter(articleMd: string): ExtractedFrontmatter {
  const lines = articleMd.split('\n');
  const titleRegion = findTaggedRegion(lines, 'title');
  const keywordsRegion = findTaggedRegion(lines, 'keywords');
  return {
    title: titleRegion ? parseTitle(titleRegion.content) : null,
    keywords: keywordsRegion ? parseKeywords(keywordsRegion.content) : [],
    contributors: findTaggedRegions(lines, 'contributor').map((r) => parseContributor(r.content)),
  };
}

export async function extractJupytextFrontmatter(
  options: RunExtractJupytextFrontmatterOptions,
): Promise<void> {
  const cwd = options.cwd;
  const articlePath = path.resolve(cwd, options.article ?? DEFAULT_ARTICLE);
  const mystPath = resolveProjectConfigPath(cwd, options.myst ?? DEFAULT_MYST);

  const articleMd = readUtf8(articlePath);

  const extracted = extractFrontmatter(articleMd);

  if (options.orcidLookup) {
    for (const contributor of extracted.contributors) {
      if (!contributor.orcid) continue;
      const info = await fetchOrcidPerson(contributor.orcid);
      if (info?.displayName) contributor.name = info.displayName;
    }
  }

  const newArticleMd = rewriteArticleMarkdown(articleMd, extracted);
  const articleChanged = newArticleMd !== articleMd;
  if (articleChanged) writeUtf8(articlePath, newArticleMd, options.dryRun);

  const mystChanged = updateYamlFile(
    mystPath,
    (doc) => setMystProjectFrontmatter(doc, extracted),
    options.dryRun,
  );

  process.stdout.write(
    [
      'Done.',
      `- Title: ${extracted.title ?? '(none found)'}`,
      `- Keywords: ${extracted.keywords.length}`,
      extracted.contributors.length
        ? `- Authors: ${extracted.contributors
            .map((c) => `${c.name ?? '(no name)'}${c.orcid ? ` (ORCID ${c.orcid})` : ''}`)
            .join('; ')}`
        : '- Authors: (none found)',
      articleChanged
        ? `- Updated: ${path.relative(cwd, articlePath)}`
        : `- No change: ${path.relative(cwd, articlePath)}`,
      mystChanged
        ? `- Updated: ${path.relative(cwd, mystPath)}`
        : `- No change: ${path.relative(cwd, mystPath)}`,
      options.dryRun ? '(dry-run: no files written)' : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

/**
 * Pull title, author, and keywords from jupytext `#region` blocks into
 * `myst.yml`, then remove those regions and set the article heading.
 */
export const extractJupytextFrontmatterStep: PipelineStep = {
  id: 'extractJupytextFrontmatter',
  label: 'Extract jupytext frontmatter regions → myst.yml + article title',
  inputs: ['markdown', 'myst', 'frontmatter'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await extractJupytextFrontmatter({
      article: 'article.md',
      myst: 'myst.yml',
      dryRun: o.dryRun,
      orcidLookup: ctx.options.orcidLookup,
      cwd: o.cwd,
    });
  },
};
