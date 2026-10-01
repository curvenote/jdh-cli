import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveGithubFromGit } from '../shared/git.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';
import { readYamlDocument, updateYamlFile } from '../shared/yaml-doc.js';

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
 * Prefers `citation.URL` (a doi.org link); falls back to the `doi` field, which
 * holds the manuscript id (`10.1515/JDH.2025.0002.R1` → `10.1515/jdh-2025-0002`)
 * or, occasionally, the registered DOI itself.
 */
export function doiFromArticleRecord(record: JdhArticleRecord): string | null {
  return doiLookup(record).doi;
}

/** DOI from an API record, and where it came from (`converted` is the manuscript-id fallback). */
function doiLookup(record: JdhArticleRecord): { doi: string | null; from: 'citation' | 'doi' | 'converted' | null } {
  const url = record.citation?.URL;
  if (typeof url === 'string') {
    const m = url.match(/doi\.org\/(10\.[^?#\s]+)/i);
    if (m) return { doi: m[1].toLowerCase(), from: 'citation' };
  }
  if (typeof record.doi === 'string') {
    const registered = record.doi.trim().match(/^10\.1515\/jdh-\d{4}-\d{4}$/i);
    if (registered) return { doi: registered[0].toLowerCase(), from: 'doi' };
    const m = record.doi.match(/^10\.1515\/JDH\.(\d{4})\.(\d{4})/i);
    if (m) return { doi: `10.1515/jdh-${m[1]}-${m[2]}`, from: 'converted' };
  }
  return { doi: null, from: null };
}

export function articleUrl(articleId: string): string {
  return `${JDH_ARTICLE_URL}/${articleId}`;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Article record from the JDH API, or a warning saying why there is none. */
async function fetchArticleRecord(
  articleId: string,
  fetchImpl: Fetch,
): Promise<{ record: JdhArticleRecord } | { warning: string }> {
  const url = `${JDH_API}/${encodeURIComponent(articleId)}/?format=json`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { warning: `could not reach the JDH API (${reason})` };
  }
  if (res.status === 404) return { warning: `article ${articleId} is not in the JDH API (HTTP 404)` };
  if (res.status === 401 || res.status === 403) {
    return { warning: `article ${articleId} is not public in the JDH API yet (HTTP ${res.status})` };
  }
  if (!res.ok) return { warning: `the JDH API returned HTTP ${res.status} for article ${articleId}` };
  try {
    return { record: (await res.json()) as JdhArticleRecord };
  } catch {
    return { warning: `the JDH API response for article ${articleId} is not JSON` };
  }
}

/**
 * DOI for an article from the JDH API, or null with a warning printed.
 * Warns separately for: API unreachable, article not found or not public,
 * and a record with no usable `doi`.
 */
export async function lookupDoi(articleId: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const result = await fetchArticleRecord(articleId, fetchImpl);
  const warn = (why: string) =>
    process.stdout.write(`Warning: ${why}; building without a DOI. Pass --doi to set one.\n`);
  if ('warning' in result) {
    warn(result.warning);
    return null;
  }
  const { doi, from } = doiLookup(result.record);
  if (!doi) {
    const field = result.record.doi;
    warn(
      `the JDH API record for ${articleId} has no usable DOI ` +
        (typeof field === 'string' && field.trim() ? `(doi field: "${field}")` : '(doi field missing)'),
    );
    return null;
  }
  if (from === 'converted') {
    process.stdout.write(
      `Note: DOI ${doi} was converted from the manuscript id "${String(result.record.doi)}" ` +
        '(the record has no citation.URL); check that it resolves.\n',
    );
  }
  return doi;
}

/** JDH article id from the git remote's repo name, else the folder name. */
export function resolveArticleId(projectRoot: string): string | null {
  const github = resolveGithubFromGit(projectRoot);
  return (github ? articleIdFromName(github) : null) ?? articleIdFromName(path.basename(projectRoot));
}

/** DOI and article URL already in a myst.yml, if any. */
function existingProjectMetadata(configPath: string): { doi: string | null; url: string | null } {
  try {
    const doc = readYamlDocument(configPath);
    const doi = doc.getIn(['project', 'doi']);
    const url = doc.getIn(['project', 'social', 'url']);
    return { doi: typeof doi === 'string' && doi ? doi : null, url: typeof url === 'string' && url ? url : null };
  } catch {
    return { doi: null, url: null };
  }
}

/**
 * Write `project.doi` and `project.social.url` (MyST's key for a website link)
 * into myst.yml, replacing any existing values.
 */
function writeProjectMetadata(configPath: string, doi: string | null, url: string | null): void {
  updateYamlFile(configPath, (doc) => {
    if (doi) doc.setIn(['project', 'doi'], doi);
    if (url) {
      if (doc.hasIn(['project', 'social', 'website'])) doc.deleteIn(['project', 'social', 'website']);
      doc.setIn(['project', 'social', 'url'], url);
    }
  });
}

export async function setJdhArticleMetadata(options: {
  cwd: string;
  projectRoot: string;
  dryRun: boolean;
  doi?: string;
  url?: string;
  /** For tests; defaults to the global fetch. */
  fetch?: Fetch;
}): Promise<{ doi: string | null; url: string | null }> {
  const articleId = resolveArticleId(options.projectRoot);
  // --doi is a pure override: nothing is fetched. Next, a value already in
  // myst.yml (from the article repo's own file) is kept as a hand edit.
  const configPath = resolveProjectConfigPath(options.cwd);
  const existing = existingProjectMetadata(configPath);
  let doi = options.doi ? normalizeDoi(options.doi) : existing.doi;
  let url = options.url ?? existing.url;
  if (!options.doi && existing.doi) process.stdout.write(`Kept project.doi from the repo's myst.yml: ${existing.doi}\n`);
  if (!options.url && existing.url) process.stdout.write(`Kept project.social.url from the repo's myst.yml: ${existing.url}\n`);

  if (!doi && articleId) doi = await lookupDoi(articleId, options.fetch);
  if (!url && articleId) url = articleUrl(articleId);

  if (!articleId && (!doi || !url)) {
    process.stdout.write(
      'Warning: could not determine the JDH article id from the git remote or folder name' +
        `${doi ? '' : '; building without a DOI (pass --doi)'}${url ? '' : '; no article URL (pass --url)'}.\n`,
    );
  }

  if (!doi && !url) return { doi, url };

  const summary = [doi && `project.doi = ${doi}`, url && `project.social.url = ${url}`]
    .filter(Boolean)
    .join(', ');
  if (options.dryRun) {
    process.stdout.write(`[dry-run] would set ${summary}\n`);
  } else {
    writeProjectMetadata(configPath, doi, url);
    process.stdout.write(`Set ${summary}\n`);
  }
  return { doi, url };
}

/**
 * Set `project.doi` and the article URL (`project.social.url`) in myst.yml.
 *
 * `--doi` / `--url` win (no lookup); otherwise the DOI comes from the JDH API
 * (`/api/articles/<id>/?format=json`, article id = repo name), with a warning
 * when it can't, and the URL from the JDH article page pattern.
 */
export const setJdhArticleMetadataStep: PipelineStep = {
  id: 'setJdhArticleMetadata',
  label: 'Set project.doi and article URL (JDH article lookup)',
  inputs: ['myst', 'git'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await setJdhArticleMetadata({
      cwd: o.cwd,
      projectRoot: o.projectRoot,
      dryRun: o.dryRun,
      doi: ctx.options.doi,
      url: ctx.options.url,
    });
  },
};
