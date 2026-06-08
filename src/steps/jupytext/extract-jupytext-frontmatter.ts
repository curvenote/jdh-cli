import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';

const DEFAULT_ARTICLE = 'article.md';
const DEFAULT_MYST = 'myst.yml';

interface RunExtractJupytextFrontmatterOptions {
  article?: string;
  myst?: string;
  dryRun: boolean;
  orcidLookup: boolean;
  cwd: string;
}

interface ExtractedFrontmatter {
  title: string | null;
  keywords: string[];
  contributor: {
    name: string | null;
    affiliationLines: string[];
    orcid: string | null;
  };
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

function findTaggedRegion(
  lines: string[],
  tag: string,
): { content: string; start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('<!--') || !line.includes('#region')) continue;
    const tags = parseTagsFromRegionLine(line);
    if (!tags.includes(tag)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes('#endregion')) {
        return { content: lines.slice(i + 1, j).join('\n').trim(), start: i, end: j };
      }
    }
    return null;
  }
  return null;
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

function parseContributor(content: string): ExtractedFrontmatter['contributor'] {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { name: null, affiliationLines: [], orcid: null };

  const header = lines[0];
  const orcid = extractOrcidId(header);

  let name = header.replace(/^#+\s*/, '').trim();
  name = name
    .replace(/[![orcid]\([^)]*\)\]\([^)]*orcid\.org\/[^)]*\)/gi, '')
    .trim();

  const affiliationLines = lines.slice(1).map((l) => l.trim()).filter(Boolean);

  return { name: name || null, affiliationLines, orcid };
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

function yamlQuote(s: string): string {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function updateMystProjectFrontmatter(mystYaml: string, extracted: ExtractedFrontmatter): string {
  const lines = mystYaml.split('\n');
  const projectIdx = lines.findIndex((l) => /^\s*project:\s*$/.test(l));
  if (projectIdx === -1) throw new Error('Project config has no `project:` block');

  let projectEnd = lines.length;
  for (let i = projectIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      projectEnd = i;
      break;
    }
  }

  const projectLines = lines.slice(projectIdx + 1, projectEnd);

  function removeKeyBlock(key: string): void {
    const keyRe = new RegExp(`^\\s{2}${key}:\\s*(.*)$`);
    for (let i = 0; i < projectLines.length; i++) {
      if (keyRe.test(projectLines[i])) {
        const isBlock = /^\s{2}\w+:\s*$/.test(projectLines[i]);
        if (!isBlock) {
          projectLines.splice(i, 1);
          return;
        }
        let j = i + 1;
        while (j < projectLines.length && /^\s{4,}\S/.test(projectLines[j])) j++;
        projectLines.splice(i, j - i);
        return;
      }
    }
  }

  function insertAfterProjectStart(blockLines: string[]): void {
    projectLines.unshift(...blockLines);
  }

  if (extracted.title) {
    removeKeyBlock('title');
    insertAfterProjectStart([`  title: ${yamlQuote(extracted.title)}`]);
  }

  if (extracted.keywords.length) {
    removeKeyBlock('keywords');
    const kwLines = ['  keywords:', ...extracted.keywords.map((k) => `    - ${yamlQuote(k)}`)];
    insertAfterProjectStart(kwLines);
  }

  if (extracted.contributor.name) {
    removeKeyBlock('authors');
    const authorLines = ['  authors:', `    - name: ${yamlQuote(extracted.contributor.name)}`];
    if (extracted.contributor.orcid) {
      authorLines.push(
        `      orcid: ${yamlQuote(`https://orcid.org/${extracted.contributor.orcid}`)}`,
      );
    }
    if (extracted.contributor.affiliationLines.length) {
      authorLines.push('      affiliations:');
      for (const aff of extracted.contributor.affiliationLines) {
        authorLines.push(`        - ${yamlQuote(aff)}`);
      }
    }
    insertAfterProjectStart(authorLines);
  }

  const newLines = [
    ...lines.slice(0, projectIdx + 1),
    ...projectLines,
    ...lines.slice(projectEnd),
  ];
  return newLines.join('\n');
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

async function extractJupytextFrontmatter(
  options: RunExtractJupytextFrontmatterOptions,
): Promise<void> {
  const cwd = options.cwd;
  const articlePath = path.resolve(cwd, options.article ?? DEFAULT_ARTICLE);
  const mystPath = resolveProjectConfigPath(cwd, options.myst ?? DEFAULT_MYST);

  const articleMd = readUtf8(articlePath);
  const lines = articleMd.split('\n');

  const titleRegion = findTaggedRegion(lines, 'title');
  const contributorRegion = findTaggedRegion(lines, 'contributor');
  const keywordsRegion = findTaggedRegion(lines, 'keywords');

  const extracted: ExtractedFrontmatter = {
    title: titleRegion ? parseTitle(titleRegion.content) : null,
    keywords: keywordsRegion ? parseKeywords(keywordsRegion.content) : [],
    contributor: contributorRegion
      ? parseContributor(contributorRegion.content)
      : { name: null, affiliationLines: [], orcid: null },
  };

  if (options.orcidLookup && extracted.contributor.orcid) {
    const info = await fetchOrcidPerson(extracted.contributor.orcid);
    if (info?.displayName) {
      extracted.contributor.name = info.displayName;
    }
  }

  const newArticleMd = rewriteArticleMarkdown(articleMd, extracted);
  const mystYaml = readUtf8(mystPath);
  const newMystYaml = updateMystProjectFrontmatter(mystYaml, extracted);

  const articleChanged = newArticleMd !== articleMd;
  const mystChanged = newMystYaml !== mystYaml;

  if (articleChanged) writeUtf8(articlePath, newArticleMd, options.dryRun);
  if (mystChanged) writeUtf8(mystPath, newMystYaml, options.dryRun);

  process.stdout.write(
    [
      'Done.',
      `- Title: ${extracted.title ?? '(none found)'}`,
      `- Keywords: ${extracted.keywords.length}`,
      `- Author: ${extracted.contributor.name ?? '(none found)'}${extracted.contributor.orcid ? ` (ORCID ${extracted.contributor.orcid})` : ''}`,
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
