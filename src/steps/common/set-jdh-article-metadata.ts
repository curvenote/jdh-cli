import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveGithubFromGit } from '../shared/git.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';

const JDH_API = 'https://journalofdigitalhistory.org/api/articles';
const JDH_ARTICLE_URL = 'https://journalofdigitalhistory.org/en/article';
const LOOKUP_TIMEOUT_MS = 15_000;

/** JDH article ids are 12 alphanumeric characters, optionally prefixed in repo names (`jdh001-…`). */
const ARTICLE_ID_RE = /(?:^|-)([A-Za-z0-9]{12})$/;

interface JdhArticleRecord {
  doi?: unknown;
  citation?: { URL?: unknown };
  abstract?: { pid?: unknown };
}

/** Extract a JDH article id from a repo name or GitHub URL, or null. */
export function articleIdFromName(name: string): string | null {
  const last = name.trim().replace(/\/+$/, '').replace(/\.git$/, '').split('/').pop() ?? '';
  const m = last.match(ARTICLE_ID_RE);
  return m ? m[1] : null;
}

/** Normalize a DOI given as `10.x/…`, `doi:10.x/…` or a doi.org URL. */
export function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
}

/**
 * Registered DOI from a JDH API article record.
 *
 * Prefers `citation.URL` (a doi.org link); falls back to the manuscript id in
 * `doi` (`10.1515/JDH.2025.0002.R1` → `10.1515/jdh-2025-0002`).
 */
export function doiFromArticleRecord(record: JdhArticleRecord): string | null {
  const url = record.citation?.URL;
  if (typeof url === 'string') {
    const m = url.match(/doi\.org\/(10\.[^?#\s]+)/i);
    if (m) return m[1].toLowerCase();
  }
  if (typeof record.doi === 'string') {
    const m = record.doi.match(/^10\.1515\/JDH\.(\d{4})\.(\d{4})/i);
    if (m) return `10.1515/jdh-${m[1]}-${m[2]}`;
  }
  return null;
}

export function articleWebsite(articleId: string): string {
  return `${JDH_ARTICLE_URL}/${articleId}`;
}

async function fetchArticleRecord(articleId: string): Promise<JdhArticleRecord | null> {
  const url = `${JDH_API}/${encodeURIComponent(articleId)}/`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      process.stdout.write(`JDH lookup for ${articleId} returned HTTP ${res.status}.\n`);
      return null;
    }
    return (await res.json()) as JdhArticleRecord;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stdout.write(`JDH lookup for ${articleId} failed: ${reason}\n`);
    return null;
  }
}

function resolveArticleId(projectRoot: string): string | null {
  const github = resolveGithubFromGit(projectRoot);
  return (github ? articleIdFromName(github) : null) ?? articleIdFromName(path.basename(projectRoot));
}

/**
 * Write `project.doi` and `project.social.url` (MyST's key for a website link)
 * into myst.yml, replacing any existing values.
 */
function writeProjectMetadata(configPath: string, doi: string | null, website: string | null): void {
  let content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes('project:\n')) {
    throw new Error(`No project: block in ${configPath}`);
  }
  if (doi) {
    content = content.replace(/^ {2}doi:.*\n/m, '');
    content = content.replace('project:\n', `project:\n  doi: ${JSON.stringify(doi)}\n`);
  }
  if (website) {
    const urlLine = `    url: ${JSON.stringify(website)}\n`;
    if (/^ {2}social:\n/m.test(content)) {
      content = content.replace(/^( {2}social:\n(?: {4}.*\n)*?) {4}(?:url|website):.*\n/m, '$1');
      content = content.replace(/^ {2}social:\n/m, `  social:\n${urlLine}`);
    } else {
      content = content.replace('project:\n', `project:\n  social:\n${urlLine}`);
    }
  }
  fs.writeFileSync(configPath, content);
}

export async function setJdhArticleMetadata(options: {
  cwd: string;
  projectRoot: string;
  dryRun: boolean;
  doi?: string;
  website?: string;
}): Promise<{ doi: string | null; website: string | null }> {
  const articleId = resolveArticleId(options.projectRoot);
  let doi = options.doi ? normalizeDoi(options.doi) : null;
  let website = options.website ?? null;

  if (!doi && articleId) {
    const record = await fetchArticleRecord(articleId);
    if (record) doi = doiFromArticleRecord(record);
  }
  if (!website && articleId) {
    website = articleWebsite(articleId);
  }

  if (!articleId && (!doi || !website)) {
    process.stdout.write('Could not determine the JDH article id from the git remote or folder name.\n');
  }
  if (!doi) process.stdout.write('No DOI found; pass --doi to set one.\n');
  if (!website) process.stdout.write('No website found; pass --website to set one.\n');

  if (!doi && !website) return { doi, website };

  const summary = [doi && `project.doi = ${doi}`, website && `project.social.url = ${website}`]
    .filter(Boolean)
    .join(', ');
  if (options.dryRun) {
    process.stdout.write(`[dry-run] would set ${summary}\n`);
  } else {
    writeProjectMetadata(resolveProjectConfigPath(options.cwd), doi, website);
    process.stdout.write(`Set ${summary}\n`);
  }
  return { doi, website };
}

/**
 * Set `project.doi` and the article website (`project.social.url`) in myst.yml.
 *
 * `--doi` / `--website` win; otherwise the DOI comes from the JDH API
 * (article id = repo name) and the website from the article URL pattern.
 */
export const setJdhArticleMetadataStep: PipelineStep = {
  id: 'setJdhArticleMetadata',
  label: 'Set project.doi and website link (JDH article lookup)',
  inputs: ['myst', 'git'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await setJdhArticleMetadata({
      cwd: o.cwd,
      projectRoot: o.projectRoot,
      dryRun: o.dryRun,
      doi: ctx.options.doi,
      website: ctx.options.website,
    });
  },
};
