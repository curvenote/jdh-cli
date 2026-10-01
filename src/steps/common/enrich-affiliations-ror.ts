import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';
import { readYamlDocument, updateYamlFile } from '../shared/yaml-doc.js';

const DEFAULT_MYST = 'myst.yml';
const DEFAULT_MIN_SCORE = 0.8;

interface RunEnrichAffiliationsRorOptions {
  myst?: string;
  dryRun: boolean;
  rorLookup: boolean;
  minScore?: number;
  cwd: string;
}

interface RorMatch {
  id: string;
  name: string;
  score: number;
}

function normalizeOrgName(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Derive short institution names from verbose DOCX affiliation strings. */
function extractInstitutionQueries(affiliation: string): string[] {
  const cleaned = affiliation.replace(/\\+/g, ' ').replace(/\s+/g, ' ').trim();
  const segments = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const queries: string[] = [];

  for (const seg of segments) {
    const uniMatches = [
      ...seg.matchAll(/\b([^,;]+(?:University|Institute|Universit[eé]|Universidad)[^,;]*)/gi),
    ].map((m) => m[1].trim());
    if (uniMatches.length) {
      queries.push(uniMatches[uniMatches.length - 1]);
      continue;
    }

    const otherMatches = [
      ...seg.matchAll(
        /\b([^,;]+(?:National Laboratory|Hospital|Academy|Laboratory|Laboratories)[^,;]*)/gi,
      ),
    ].map((m) => m[1].trim());
    if (otherMatches.length) {
      queries.push(otherMatches[otherMatches.length - 1]);
    }
  }

  return [...new Set(queries.filter((q) => q.length >= 4))];
}

function computeMatchScore(query: string, orgName: string): number {
  const a = normalizeOrgName(query);
  const b = normalizeOrgName(orgName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return 0.75 + 0.2 * (shorter / longer);
  }

  const at = new Set(a.split(/\s+/).filter((t) => t.length > 2));
  const bt = new Set(b.split(/\s+/).filter((t) => t.length > 2));
  if (!at.size || !bt.size) return 0;

  let overlap = 0;
  for (const t of at) {
    if (bt.has(t)) overlap++;
  }
  return overlap / (at.size + bt.size - overlap);
}

function parseRorItem(item: unknown): { id: string; name: string } | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;

  const legacyOrg = record.organization;
  if (legacyOrg && typeof legacyOrg === 'object') {
    const org = legacyOrg as Record<string, unknown>;
    const id = typeof org.id === 'string' ? org.id : null;
    const name = typeof org.name === 'string' ? org.name : null;
    if (id && name) return { id, name };
  }

  const id = typeof record.id === 'string' ? record.id : null;
  const names = Array.isArray(record.names) ? record.names : [];
  let name: string | null = null;

  for (const entry of names) {
    if (!entry || typeof entry !== 'object') continue;
    const types = Array.isArray((entry as { types?: unknown }).types)
      ? ((entry as { types: string[] }).types ?? [])
      : [];
    const value = (entry as { value?: unknown }).value;
    if (types.includes('ror_display') && typeof value === 'string' && value) {
      name = value;
      break;
    }
  }

  if (!name) {
    for (const entry of names) {
      if (!entry || typeof entry !== 'object') continue;
      const value = (entry as { value?: unknown }).value;
      if (typeof value === 'string' && value) {
        name = value;
        break;
      }
    }
  }

  return id && name ? { id, name } : null;
}

async function searchRorQuery(query: string): Promise<RorMatch | null> {
  const url = `https://api.ror.org/organizations?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: unknown[] };
    const items = Array.isArray(json?.items) ? json.items : [];
    if (!items.length) return null;

    let best: RorMatch | null = null;
    for (const item of items.slice(0, 5)) {
      const parsed = parseRorItem(item);
      if (!parsed) continue;

      const apiScore =
        item && typeof item === 'object' && typeof (item as { score?: unknown }).score === 'number'
          ? ((item as { score: number }).score ?? 0)
          : 0;
      const score = apiScore > 0 ? apiScore : computeMatchScore(query, parsed.name);

      if (!best || score > best.score) {
        best = { id: parsed.id, name: parsed.name, score };
      }
    }

    return best;
  } catch {
    return null;
  }
}

async function resolveAffiliationRor(
  affiliation: string,
  minScore: number,
): Promise<RorMatch | null> {
  const queries = extractInstitutionQueries(affiliation);
  if (!queries.length) queries.push(affiliation);

  let best: (RorMatch & { query: string }) | null = null;
  for (const query of queries) {
    const match = await searchRorQuery(query);
    if (!match) continue;
    if (!best || match.score > best.score) {
      best = { ...match, query };
    }
  }

  if (!best) return null;
  return acceptRorMatch(best.query, best, minScore) ? best : null;
}

function acceptRorMatch(original: string, match: RorMatch, minScore: number): boolean {
  if (match.score >= minScore) return true;

  const a = normalizeOrgName(original);
  const b = normalizeOrgName(match.name);

  if ((a.includes(b) || b.includes(a)) && match.score >= Math.min(0.7, minScore)) {
    return true;
  }
  return false;
}

type Author = Record<string, unknown> & { affiliations?: unknown };

/** Replace plain-string affiliations with ROR-backed `{ institution, ror, name? }` objects. */
async function enrichAuthorsAffiliations(
  authors: Author[],
  opts: { rorLookup: boolean; minScore: number },
): Promise<{ authors: Author[]; changes: number }> {
  let changes = 0;
  const cache = new Map<string, RorMatch | null>();
  const enriched: Author[] = [];

  for (const author of authors) {
    if (!author || typeof author !== 'object' || !Array.isArray(author.affiliations)) {
      enriched.push(author);
      continue;
    }
    const affiliations: unknown[] = [];
    for (const affiliation of author.affiliations) {
      if (typeof affiliation !== 'string') {
        affiliations.push(affiliation);
        continue;
      }
      let resolved = cache.get(affiliation);
      if (resolved === undefined) {
        resolved = opts.rorLookup ? await resolveAffiliationRor(affiliation, opts.minScore) : null;
        cache.set(affiliation, resolved);
      }
      if (!resolved) {
        affiliations.push(affiliation);
        continue;
      }
      changes++;
      affiliations.push({
        institution: resolved.name,
        ror: resolved.id,
        ...(normalizeOrgName(resolved.name) !== normalizeOrgName(affiliation) ? { name: affiliation } : {}),
      });
    }
    enriched.push({ ...author, affiliations });
  }

  return { authors: enriched, changes };
}

/**
 * Enrich author affiliation strings in the project config using ROR (Research Organization Registry).
 * Resolves plain-string affiliations to MyST affiliation objects with `institution` and `ror` fields.
 */
async function enrichAffiliationsRor(
  options: RunEnrichAffiliationsRorOptions,
): Promise<void> {
  const cwd = options.cwd;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error(`minScore must be between 0 and 1 (got ${minScore})`);
  }

  const mystPath = resolveProjectConfigPath(cwd, options.myst ?? DEFAULT_MYST);

  const doc = readYamlDocument(mystPath);
  if (!doc.has('project')) throw new Error('Project config has no `project:` block');
  const authors = (doc.toJS() as { project?: { authors?: unknown } }).project?.authors;

  let changes = 0;
  let changed = false;
  if (Array.isArray(authors)) {
    const result = await enrichAuthorsAffiliations(authors as Author[], {
      rorLookup: options.rorLookup,
      minScore,
    });
    changes = result.changes;
    if (changes) {
      changed = updateYamlFile(
        mystPath,
        (d) => d.setIn(['project', 'authors'], result.authors),
        options.dryRun,
      );
    }
  }

  process.stdout.write(
    [
      'Done.',
      `- config: ${path.relative(cwd, mystPath)}`,
      `- ROR lookup: ${options.rorLookup ? 'enabled' : 'disabled'}`,
      `- minScore: ${minScore}`,
      `- affiliation enrichments applied: ${changes}`,
      changed ? '- config updated' : '- no changes',
      options.dryRun ? '(dry-run: no files written)' : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

/**
 * Resolve plain-string author affiliations in `myst.yml` to ROR-backed
 * institution objects (when `--ror-lookup` is enabled).
 */
export const enrichAffiliationsRorStep: PipelineStep = {
  id: 'enrichAffiliationsRor',
  label: 'Enrich affiliations via ROR',
  inputs: ['myst'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await enrichAffiliationsRor({
      myst: 'myst.yml',
      dryRun: o.dryRun,
      rorLookup: ctx.options.rorLookup,
      minScore: ctx.options.rorMinScore,
      cwd: o.cwd,
    });
  },
};
