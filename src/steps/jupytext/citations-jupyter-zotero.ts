import fs from 'node:fs';
import path from 'node:path';
import { isSeq } from 'yaml';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';
import { updateYamlFile } from '../shared/yaml-doc.js';
import { whenNotebook } from '../shared/when.js';

interface CitationManagerRef {
  source: string;
  id: string;
}

interface CslItem {
  id?: string;
  system_id?: string;
  type?: string;
  title?: string;
  DOI?: string;
  doi?: string;
  URL?: string;
  url?: string;
  note?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  number?: string;
  ISBN?: string;
  'container-title'?: string;
  'publisher-place'?: string;
  'event-place'?: string;
  event?: string;
  'number-of-pages'?: number | string;
  issued?: { 'date-parts'?: Array<Array<number | string>> };
  author?: Array<{ family?: string; given?: string }>;
  editor?: Array<{ family?: string; given?: string }>;
}

export interface JupyterZoteroOptions {
  article: string;
  notebook: string;
  bib: string;
  myst: string;
  dryRun: boolean;
  rewriteMd: boolean;
  updateMyst: boolean;
  stripCitationManagerComments: boolean;
  cwd?: string;
}

function readUtf8(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function writeUtf8(p: string, content: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.writeFileSync(p, content, 'utf8');
}

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[)\].,;:]+$/g, '');
}

function parseDoiFromNote(note: string): string | null {
  const m = note.match(/\bDOI:\s*([^\s]+)\b/i);
  return m?.[1] ?? null;
}

function parseDoiFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/(dx\.)?doi\.org\/(.+)$/i);
  if (!m) return null;
  return decodeURIComponent(m[2]);
}

function extractDoi(item: CslItem): string | null {
  const raw =
    item?.DOI ??
    item?.doi ??
    (typeof item?.note === 'string' ? parseDoiFromNote(item.note) : null) ??
    (typeof item?.URL === 'string' ? parseDoiFromUrl(item.URL) : null) ??
    (typeof item?.url === 'string' ? parseDoiFromUrl(item.url) : null);

  if (!raw) return null;

  const doi = stripTrailingPunctuation(String(raw).trim())
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim();

  return doi || null;
}

function doiToCitekey(doi: string): string | null {
  const safe = `doi${doi}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || null;
}

function zoteroIdToCitekey(zoteroId: string): string {
  return `zotero_${String(zoteroId).replace(/[^A-Za-z0-9]+/g, '_')}`;
}

function getIssuedDateParts(item: CslItem): {
  year: string | null;
  month: string | null;
  day: string | null;
} {
  const dp = item?.issued?.['date-parts'];
  const first = Array.isArray(dp) && Array.isArray(dp[0]) ? dp[0] : null;
  if (!first || !first.length) return { year: null, month: null, day: null };
  const [year, month, day] = first;
  return {
    year: typeof year === 'number' ? String(year) : year ? String(year) : null,
    month:
      typeof month === 'number' ? String(month).padStart(2, '0') : month ? String(month) : null,
    day: typeof day === 'number' ? String(day).padStart(2, '0') : day ? String(day) : null,
  };
}

function normalizePages(pages: string | number | null | undefined): string | null {
  if (!pages) return null;
  return String(pages).replace(/–/g, '--');
}

function escapeBibtexValue(v: unknown): string {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/%/g, '\\%')
    .replace(/&/g, '\\&')
    .replace(/_/g, '\\_')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#');
}

function formatNameList(
  list: Array<{ family?: string; given?: string }> | null | undefined,
): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const names = list
    .map((n) => {
      const family = n?.family ? String(n.family).trim() : '';
      const given = n?.given ? String(n.given).trim() : '';
      if (family && given) return `${family}, ${given}`;
      if (family) return family;
      if (given) return given;
      return null;
    })
    .filter(Boolean);
  return names.length ? names.join(' and ') : null;
}

type BibtexType = 'article' | 'inproceedings' | 'incollection' | 'book' | 'misc';

function pickBibtexType(item: CslItem): BibtexType {
  const t = String(item?.type ?? '').toLowerCase();
  if (t === 'article-journal') return 'article';
  if (t === 'paper-conference') return 'inproceedings';
  if (t === 'chapter') return 'incollection';
  if (t === 'book') return 'book';
  if (t === 'article') return item?.['container-title'] ? 'article' : 'misc';
  return 'misc';
}

function buildBibtexFields(item: CslItem, _citekey: string): Record<string, string> {
  const fields: Record<string, string> = {};

  const authors = formatNameList(item.author);
  const editors = formatNameList(item.editor);
  const { year, month } = getIssuedDateParts(item);

  if (authors) fields.author = authors;
  if (!authors && editors) fields.editor = editors;
  if (item.title) fields.title = item.title;
  if (year) fields.year = year;
  if (month) fields.month = month;

  const bibType = pickBibtexType(item);
  if (bibType === 'article') {
    if (item['container-title']) fields.journal = item['container-title'];
    if (item.volume) fields.volume = item.volume;
    if (item.issue) fields.number = item.issue;
    if (item.page) {
      const pages = normalizePages(item.page);
      if (pages) fields.pages = pages;
    }
  } else if (bibType === 'inproceedings') {
    if (item['container-title']) fields.booktitle = item['container-title'];
    if (editors) fields.editor = editors;
    if (item.page) {
      const pages = normalizePages(item.page);
      if (pages) fields.pages = pages;
    }
    if (item.publisher) fields.publisher = item.publisher;
    if (item['publisher-place'] || item['event-place'])
      fields.address = item['publisher-place'] ?? item['event-place'] ?? '';
    if (item.event) fields.note = item.event;
  } else if (bibType === 'incollection') {
    if (item['container-title']) fields.booktitle = item['container-title'];
    if (editors) fields.editor = editors;
    if (item.page) {
      const pages = normalizePages(item.page);
      if (pages) fields.pages = pages;
    }
    if (item.publisher) fields.publisher = item.publisher;
    if (item['publisher-place'] || item['event-place'])
      fields.address = item['publisher-place'] ?? item['event-place'] ?? '';
    if (item.ISBN) fields.isbn = item.ISBN;
  } else if (bibType === 'book') {
    if (item.publisher) fields.publisher = item.publisher;
    if (item['publisher-place'] || item['event-place'])
      fields.address = item['publisher-place'] ?? item['event-place'] ?? '';
    if (item.ISBN) fields.isbn = item.ISBN;
    if (item['number-of-pages']) fields.pages = String(item['number-of-pages']);
  } else {
    if (item.publisher) fields.publisher = item.publisher;
    if (item.URL) fields.url = item.URL;
    if (item.number) fields.number = item.number;
  }

  const doi = extractDoi(item);
  if (doi) fields.doi = doi;
  if (!fields.url && item.URL) fields.url = item.URL;

  if (item.system_id)
    fields.note = fields.note ? `${fields.note}; ${item.system_id}` : item.system_id;
  else if (item.id) fields.note = fields.note ? `${fields.note}; ${item.id}` : item.id;

  return fields;
}

function renderBibtexEntry(
  bibType: string,
  citekey: string,
  fields: Record<string, string>,
): string {
  const orderedKeys = [
    'author',
    'editor',
    'title',
    'journal',
    'booktitle',
    'year',
    'month',
    'volume',
    'number',
    'pages',
    'publisher',
    'address',
    'doi',
    'url',
    'isbn',
    'note',
  ];

  const restKeys = Object.keys(fields).filter((k) => !orderedKeys.includes(k)).sort();
  const keys = [...orderedKeys.filter((k) => fields[k]), ...restKeys];

  const lines = keys.map((k) => `  ${k} = {${escapeBibtexValue(fields[k])}},`);
  if (lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/},$/, '}');
  }

  return `@${bibType}{${citekey},\n${lines.join('\n')}\n}\n`;
}

function buildCitekeyMap(itemsById: Record<string, CslItem>): Map<string, string> {
  const citekeyById = new Map<string, string>();
  const used = new Map<string, number>();

  const ids = Object.keys(itemsById).sort();
  for (const id of ids) {
    const item = itemsById[id];
    const doi = extractDoi(item);
    const base = (doi && doiToCitekey(doi)) || zoteroIdToCitekey(id);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const citekey = count === 0 ? base : `${base}${String.fromCharCode('a'.charCodeAt(0) + count)}`;
    citekeyById.set(id, citekey);
  }

  return citekeyById;
}

function loadZoteroItemsFromNotebook(notebookPath: string): Record<string, CslItem> {
  const nb = JSON.parse(readUtf8(notebookPath)) as {
    metadata?: Record<string, unknown>;
  };
  const cm =
    (nb?.metadata?.['citation-manager'] as Record<string, unknown> | undefined) ??
    (nb?.metadata?.citation_manager as Record<string, unknown> | undefined) ??
    null;
  const items = cm?.items as Record<string, unknown> | null;

  if (items?.zotero && typeof items.zotero === 'object')
    return items.zotero as Record<string, CslItem>;

  if (items && typeof items === 'object') return items as Record<string, CslItem>;

  return {};
}

function extractBalancedJsonObject(s: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') depth--;

    if (depth === 0) {
      return s.slice(startIdx, i + 1);
    }
  }

  return null;
}

function extractCitationManagerMappingsFromMd(md: string): Map<string, CitationManagerRef[]> {
  const map = new Map<string, CitationManagerRef[]>();
  const re = /<!--\s*#region[\s\S]*?-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const comment = m[0];
    const idx = comment.indexOf('citation-manager=');
    if (idx === -1) continue;
    const start = comment.indexOf('{', idx);
    if (start === -1) continue;

    const jsonText = extractBalancedJsonObject(comment, start);
    if (!jsonText) continue;

    let parsed: { citations?: Record<string, CitationManagerRef[]> };
    try {
      parsed = JSON.parse(jsonText) as { citations?: Record<string, CitationManagerRef[]> };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Failed to parse citation-manager JSON in article.md region comment: ${msg}`,
        { cause: e },
      );
    }
    const citations = parsed?.citations;
    if (!citations || typeof citations !== 'object') continue;
    for (const [citeId, refs] of Object.entries(citations)) {
      if (!Array.isArray(refs)) continue;
      map.set(citeId, refs);
    }
  }
  return map;
}

function stripCitationManagerFromComment(comment: string): string {
  let out = comment;
  while (true) {
    const idx = out.indexOf('citation-manager=');
    if (idx === -1) break;
    const start = out.indexOf('{', idx);
    if (start === -1) {
      out = out.slice(0, idx) + out.slice(idx + 'citation-manager='.length);
      continue;
    }
    const jsonText = extractBalancedJsonObject(out, start);
    if (!jsonText) break;
    const end = start + jsonText.length;

    let removeStart = idx;
    while (removeStart > 0 && out[removeStart - 1] === ' ') removeStart--;

    let removeEnd = end;
    while (removeEnd < out.length && out[removeEnd] === ' ') removeEnd++;

    out = out.slice(0, removeStart) + out.slice(removeEnd);
  }

  out = out.replace(/\s{2,}/g, ' ');
  out = out.replace(/(#region)\s+-->/g, '$1 -->');
  return out;
}

function stripCitationManagerFromAllComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, (comment) => {
    if (!comment.includes('citation-manager=')) return comment.replace(/(\S)-->/g, '$1 -->');
    return stripCitationManagerFromComment(comment).replace(/(\S)-->/g, '$1 -->');
  });
}

function rewriteMdCitationsToMyst(
  md: string,
  citeIdToRefs: Map<string, CitationManagerRef[]>,
  citekeyByZoteroId: Map<string, string>,
  _opts: { stripCitationManagerComments: boolean },
): string {
  let out = md;

  out = out.replace(/<cite\s+id="([^"]+)"[^>]*>[\s\S]*?<\/cite>/g, (full, citeId: string) => {
    const refs = citeIdToRefs.get(citeId);
    if (!refs || refs.length === 0) return full;

    const keys: string[] = [];
    for (const r of refs) {
      if (!r || r.source !== 'zotero' || !r.id) continue;
      const key = citekeyByZoteroId.get(r.id);
      if (key) keys.push(`@${key}`);
    }
    if (keys.length === 0) return full;
    if (keys.length === 1) return `[@${keys[0].slice(1)}]`;
    return `[${keys.join('; ')}]`;
  });

  out = out.replace(/\[@[^\]]+?\](?:\s*,\s*\[@[^\]]+?\])+/g, (chunk) => {
    const keys: string[] = [];
    const re = /\[@([^\]]+?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk)) !== null) keys.push(m[1].trim());
    if (keys.length <= 1) return chunk;
    return `[@${keys.join('; @')}]`.replace(/@{2,}/g, '@');
  });

  out = out.replace(/\(\s*(\[@[^\]]+?\])\s*\)/g, '$1');
  out = stripCitationManagerFromAllComments(out);

  return out;
}

/** Add `bibPath` to `project.bibliography` in myst.yml, keeping existing entries. */
function ensureMystBibliography(mystPath: string, bibPath: string, dryRun: boolean): void {
  updateYamlFile(
    mystPath,
    (doc) => {
      if (!doc.has('project')) return;
      const current = doc.getIn(['project', 'bibliography']);
      const list: unknown[] = isSeq(current) ? current.toJSON() : [];
      if (!list.includes(bibPath)) doc.setIn(['project', 'bibliography'], [...list, bibPath]);
    },
    dryRun,
  );
}

/** Export Zotero metadata from a Jupyter notebook into BibTeX and rewrite markdown citations. */
export async function jupyterZotero(options: JupyterZoteroOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const articlePath = path.resolve(cwd, options.article);
  const notebookPath = path.resolve(cwd, options.notebook);
  const bibPath = path.resolve(cwd, options.bib);
  const mystPath = resolveProjectConfigPath(cwd, options.myst);

  const zoteroItems = loadZoteroItemsFromNotebook(notebookPath);
  if (Object.keys(zoteroItems).length === 0) {
    // An empty references.bib breaks myst build, so write nothing and leave myst.yml alone.
    console.log(`No citation-manager items in ${path.relative(cwd, notebookPath)}; skipping references.bib.`);
    return;
  }
  const citekeyByZoteroId = buildCitekeyMap(zoteroItems);

  const bibEntries: string[] = [];
  const ids = Object.keys(zoteroItems).sort();
  for (const id of ids) {
    const item = zoteroItems[id];
    const citekey = citekeyByZoteroId.get(id)!;
    const bibType = pickBibtexType(item);
    const fields = buildBibtexFields(item, citekey);
    bibEntries.push(renderBibtexEntry(bibType, citekey, fields));
  }

  const bibText =
    `% Generated from ${path.basename(notebookPath)} notebook metadata (citation-manager)\n` +
    `% Entries: ${bibEntries.length}\n\n` +
    bibEntries.join('\n');

  writeUtf8(bibPath, bibText, options.dryRun);

  if (options.rewriteMd) {
    const md = readUtf8(articlePath);
    const citeIdToRefs = extractCitationManagerMappingsFromMd(md);
    const rewritten = rewriteMdCitationsToMyst(md, citeIdToRefs, citekeyByZoteroId, {
      stripCitationManagerComments: options.stripCitationManagerComments,
    });

    if (rewritten !== md) {
      writeUtf8(articlePath, rewritten, options.dryRun);
    }
  }

  if (options.updateMyst && fileExists(mystPath)) {
    ensureMystBibliography(mystPath, path.basename(bibPath), options.dryRun);
  }

  console.log(
    [
      'Done.',
      `- Notebook: ${path.relative(cwd, notebookPath)}`,
      `- BibTeX:   ${path.relative(cwd, bibPath)} (${bibEntries.length} entries)`,
      options.rewriteMd ? `- Rewrote:  ${path.relative(cwd, articlePath)}` : null,
      options.updateMyst && fileExists(mystPath)
        ? `- Updated:  ${path.relative(cwd, mystPath)}`
        : null,
      options.dryRun ? '(dry-run: no files written)' : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/**
 * Export Zotero items from notebook citation-manager metadata to `references.bib`,
 * rewrite `<cite>` tags in markdown to MyST citations, and link the bib in myst.yml.
 */
export const citationsJupyterZoteroStep: PipelineStep = {
  id: 'citationsJupyterZotero',
  label: 'Extract citations + BibTeX + rewrite markdown (jupyter-zotero)',
  inputs: ['ipynb', 'markdown', 'myst'],
  when: whenNotebook,
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await jupyterZotero({
      article: 'article.md',
      notebook: 'article.ipynb',
      bib: 'references.bib',
      myst: 'myst.yml',
      dryRun: o.dryRun,
      rewriteMd: true,
      updateMyst: true,
      stripCitationManagerComments: false,
      cwd: o.cwd,
    });
  },
};
