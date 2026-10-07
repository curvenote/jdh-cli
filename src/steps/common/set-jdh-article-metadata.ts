import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { pointExportsAtSidebarImages } from '../../engine/sidebar-images.js';
import { META_JDH_FILE } from '../../init/bundled-assets.js';
import { resolveGithubFromGit } from '../shared/git.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';
import { parseMarkdownFrontmatter, readYamlDocument, updateYamlFile } from '../shared/yaml-doc.js';

const JDH_API = 'https://journalofdigitalhistory.org/api/articles';
const JDH_ARTICLE_URL = 'https://journalofdigitalhistory.org/en/article';
const LOOKUP_TIMEOUT_MS = 15_000;

/** JDH article ids are 12 alphanumeric characters, optionally prefixed in repo names (`jdh001-…`). */
const ARTICLE_ID_RE = /(?:^|-)([A-Za-z0-9]{12})$/;

interface JdhArticleRecord {
  doi?: unknown;
  citation?: { URL?: unknown };
  abstract?: { pid?: unknown };
  publication_date?: unknown;
  copyright_type?: unknown;
  issue?: { name?: unknown };
}

/** MyST licence id for the API's `copyright_type`: `CC_BY_NC_ND` → `CC-BY-NC-ND-4.0`. */
export function licenseFromCopyrightType(value: unknown): string | null {
  if (typeof value !== 'string' || !/^CC_BY(_(NC|ND|SA))*$/i.test(value.trim())) return null;
  return `${value.trim().toUpperCase().replace(/_/g, '-')}-4.0`;
}

/**
 * MyST licence id from the article's copyright text, for articles not yet in
 * the API: the Creative Commons link (`licenses/by-nc-nd/4.0`) or the name
 * (`CC-BY-NC-ND`).
 */
export function licenseFromCopyrightText(text: string): string | null {
  const m =
    text.match(/creativecommons\.org\/licenses\/(by(?:-nc)?(?:-nd|-sa)?)\//i) ??
    text.match(/\bCC[- ](BY(?:-NC)?(?:-ND|-SA)?)\b/i);
  return m ? `CC-${m[1].toUpperCase()}-4.0` : null;
}

/** Publication day (`YYYY-MM-DD`) from the API's timestamp, in the timezone it was given in. */
export function dateFromPublicationDate(value: unknown): string | null {
  const m = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
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
  return doiFromLookup(articleId, await fetchArticleRecord(articleId, fetchImpl));
}

function doiFromLookup(
  articleId: string,
  result: { record: JdhArticleRecord } | { warning: string },
): string | null {
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

interface ProjectMetadata {
  doi: string | null;
  url: string | null;
  /** Publication day, `YYYY-MM-DD`. */
  date: string | null;
  /** MyST licence id, e.g. `CC-BY-4.0`. */
  license: string | null;
  /** JDH issue name, written as `project.venue.title`. */
  issue: string | null;
}

/** Values already in a myst.yml (the article repo's own file wins, JDH-012). */
function existingProjectMetadata(configPath: string): ProjectMetadata {
  const none: ProjectMetadata = { doi: null, url: null, date: null, license: null, issue: null };
  try {
    const doc = readYamlDocument(configPath);
    const str = (keys: string[]) => {
      const v = doc.getIn(keys);
      return typeof v === 'string' && v ? v : null;
    };
    const date = doc.getIn(['project', 'date']);
    return {
      doi: str(['project', 'doi']),
      url: str(['project', 'social', 'url']),
      date: date instanceof Date ? date.toISOString().slice(0, 10) : str(['project', 'date']),
      license: str(['project', 'license']) ?? str(['project', 'license', 'content']),
      issue: str(['project', 'venue', 'title']) ?? str(['project', 'venue']),
    };
  } catch {
    return none;
  }
}

/**
 * Write the article metadata into myst.yml: `project.doi`, `project.social.url`
 * (MyST's key for a website link), `project.date`, `project.license` and
 * `project.venue.title` (the JDH issue). Values that are null are left alone.
 */
function writeProjectMetadata(configPath: string, meta: ProjectMetadata): void {
  updateYamlFile(configPath, (doc) => {
    if (meta.doi) doc.setIn(['project', 'doi'], meta.doi);
    if (meta.url) {
      if (doc.hasIn(['project', 'social', 'website'])) doc.deleteIn(['project', 'social', 'website']);
      doc.setIn(['project', 'social', 'url'], meta.url);
    }
    if (meta.date) doc.setIn(['project', 'date'], meta.date);
    if (meta.license) doc.setIn(['project', 'license'], meta.license);
    if (meta.issue && !doc.hasIn(['project', 'venue'])) doc.setIn(['project', 'venue', 'title'], meta.issue);
  });
}

/** Licence named in the article's copyright cell (moved to `parts.copyright` by extractJupytextParts). */
function licenseFromArticle(cwd: string): string | null {
  try {
    const { doc } = parseMarkdownFrontmatter(fs.readFileSync(path.join(cwd, 'article.md'), 'utf8'));
    const text = doc.getIn(['parts', 'copyright']);
    return typeof text === 'string' ? licenseFromCopyrightText(text) : null;
  } catch {
    return null;
  }
}

export async function setJdhArticleMetadata(options: {
  cwd: string;
  projectRoot: string;
  dryRun: boolean;
  doi?: string;
  url?: string;
  /** For tests; defaults to the global fetch. */
  fetch?: Fetch;
}): Promise<ProjectMetadata> {
  const articleId = resolveArticleId(options.projectRoot);
  // --doi / --url are pure overrides. Next, a value already in myst.yml (from
  // the article repo's own file) is kept as a hand edit (JDH-012). Anything
  // still missing comes from the article's JDH API record, fetched once.
  const configPath = resolveProjectConfigPath(options.cwd);
  const existing = existingProjectMetadata(configPath);
  const meta: ProjectMetadata = {
    ...existing,
    doi: options.doi ? normalizeDoi(options.doi) : existing.doi,
    url: options.url ?? existing.url,
  };
  if (!options.doi && existing.doi) process.stdout.write(`Kept project.doi from the repo's myst.yml: ${existing.doi}\n`);
  if (!options.url && existing.url) process.stdout.write(`Kept project.social.url from the repo's myst.yml: ${existing.url}\n`);

  if (articleId && (!meta.doi || !meta.date || !meta.license || !meta.issue)) {
    const lookup = await fetchArticleRecord(articleId, options.fetch ?? fetch);
    if (!meta.doi) meta.doi = doiFromLookup(articleId, lookup);
    if ('record' in lookup) {
      const { record } = lookup;
      meta.date ??= dateFromPublicationDate(record.publication_date);
      meta.license ??= licenseFromCopyrightType(record.copyright_type);
      meta.issue ??= typeof record.issue?.name === 'string' && record.issue.name ? record.issue.name : null;
    }
    if (!meta.date) process.stdout.write('Note: no publication date in the JDH API; the PDF says "Forthcoming".\n');
  }
  meta.license ??= licenseFromArticle(options.cwd);
  if (!meta.url && articleId) meta.url = articleUrl(articleId);

  if (!articleId && (!meta.doi || !meta.url)) {
    process.stdout.write(
      'Warning: could not determine the JDH article id from the git remote or folder name' +
        `${meta.doi ? '' : '; building without a DOI (pass --doi)'}${meta.url ? '' : '; no article URL (pass --url)'}.\n`,
    );
  }

  const summary = [
    meta.doi && `project.doi = ${meta.doi}`,
    meta.url && `project.social.url = ${meta.url}`,
    meta.date && `project.date = ${meta.date}`,
    meta.license && `project.license = ${meta.license}`,
    meta.issue && `project.venue.title = ${meta.issue}`,
  ].filter(Boolean);
  if (!summary.length) return meta;

  if (options.dryRun) {
    process.stdout.write(`[dry-run] would set ${summary.join(', ')}\n`);
  } else {
    writeProjectMetadata(configPath, meta);
    // Template options for the PDF sidebar: the article URL, and "Forthcoming"
    // when there is no publication date (MyST would otherwise print today's date).
    const exportOptions = new Map<string, string | boolean>([['forthcoming', !meta.date]]);
    if (meta.url) exportOptions.set('article_url', meta.url);
    for (const config of [META_JDH_FILE, 'myst.yml']) {
      pointExportsAtSidebarImages(path.join(options.cwd, config), exportOptions);
    }
    process.stdout.write(`Set ${summary.join(', ')}\n`);
  }
  return meta;
}

/**
 * Set the article's DOI, URL, publication date, licence and issue in myst.yml
 * (JDH-020, JDH-041).
 *
 * `--doi` / `--url` win, then values already in the repo's myst.yml; the rest
 * come from the JDH API record (`/api/articles/<id>/?format=json`, article id =
 * repo name). An article not yet public in the API gets no date ("Forthcoming")
 * and the licence named in its copyright cell.
 */
export const setJdhArticleMetadataStep: PipelineStep = {
  id: 'setJdhArticleMetadata',
  label: 'Set DOI, URL, date, licence and issue (JDH article lookup)',
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
