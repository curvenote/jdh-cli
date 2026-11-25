import fs from 'node:fs';
import path from 'node:path';
import { isSeq } from 'yaml';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { resolveProjectConfigPath } from '../shared/myst-config.js';
import {
  findAuthorEntry,
  listProjectBibFiles,
  listWorkdirAuthorBibFiles,
  loadAuthorBibEntries,
} from '../shared/author-bib.js';
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
  author?: Array<{ family?: string; given?: string; literal?: string }>;
  editor?: Array<{ family?: string; given?: string; literal?: string }>;
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
  /** Read Zotero items from the notebook (default true; --no-zotero turns it off). */
  zotero?: boolean;
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

/**
 * BibTeX name list, already escaped. A name with only a family part, or a CSL
 * `literal`, is an organisation ("International Association of Sound
 * Archives", "OpenAI"): it is braced so BibTeX keeps it whole instead of
 * reading it as a person (JDH-048).
 */
export function formatNameList(
  list: Array<{ family?: string; given?: string; literal?: string }> | null | undefined,
): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const names = list
    .map((n) => {
      const family = n?.family ? String(n.family).trim() : '';
      const given = n?.given ? String(n.given).trim() : '';
      const literal = n?.literal ? String(n.literal).trim() : '';
      if (family && given) return `${escapeBibtexValue(family)}, ${escapeBibtexValue(given)}`;
      if (family || literal) return `{${escapeBibtexValue(family || literal)}}`;
      if (given) return `{${escapeBibtexValue(given)}}`;
      return null;
    })
    .filter(Boolean);
  return names.length ? names.join(' and ') : null;
}

/** Fields whose values are already escaped BibTeX (name lists). */
const PRE_ESCAPED_FIELDS = new Set(['author', 'editor']);
/** Fields read literally: escaping would print "8944\\_2012" in the reference list. */
const VERBATIM_FIELDS = new Set(['doi', 'url']);

function bibtexFieldValue(key: string, value: string): string {
  if (PRE_ESCAPED_FIELDS.has(key)) return value;
  if (VERBATIM_FIELDS.has(key)) return value.replace(/[{}]/g, '');
  return escapeBibtexValue(value);
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

  const lines = keys.map((k) => `  ${k} = {${bibtexFieldValue(k, fields[k])}},`);
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

/**
 * cite2c writes dates as `{year, month, day}`; the rest of this file, and CSL-JSON,
 * expect `{"date-parts": [[y, m, d]]}`. Without this every entry loses its year.
 */
function cite2cDateToCsl(d: unknown): { 'date-parts'?: Array<Array<number | string>> } | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const o = d as Record<string, unknown>;
  if (o['date-parts']) return o as { 'date-parts': Array<Array<number | string>> };
  if (o.year == null) return undefined;
  const parts = [o.year, o.month, o.day].filter((x) => x != null).map(Number);
  return { 'date-parts': [parts] };
}

/**
 * Items from a notebook's cite2c metadata. cite2c keeps the whole bibliography in
 * `metadata.cite2c.citations`, keyed by Zotero id, and leaves only an empty
 * `<cite data-cite="…"></cite>` marker in the prose (JDH-080).
 */
function loadCite2cItemsFromNotebook(notebookPath: string): Record<string, CslItem> {
  if (!fileExists(notebookPath)) return {};
  const nb = JSON.parse(readUtf8(notebookPath)) as { metadata?: Record<string, unknown> };
  const cite2c = nb?.metadata?.cite2c as Record<string, unknown> | undefined;
  const citations = cite2c?.citations;
  if (!citations || typeof citations !== 'object') return {};

  const out: Record<string, CslItem> = {};
  for (const [id, raw] of Object.entries(citations as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = { ...(raw as CslItem) };
    const issued = cite2cDateToCsl((raw as Record<string, unknown>).issued);
    if (issued) item.issued = issued;
    out[id] = item;
  }
  return out;
}

function loadZoteroItemsFromNotebook(notebookPath: string): Record<string, CslItem> {
  if (!fileExists(notebookPath)) return {};
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

/** Zotero item ids (`group/KEY`) from the links inside a `<cite>` element. */
export function zoteroIdsFromCiteHtml(html: string): string[] {
  const ids: string[] = [];
  const re = /#zotero(?:%7C|\|)(\d+)(?:%2F|\/)([A-Z0-9]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(`${m[1]}/${m[2]}`);
  return ids;
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Visible text of a `<cite>` element, e.g. "(Meadows & Sternfeld, 2023)". */
export function citeVisibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m)
    .trim();
}

/**
 * Both citation elements: citation-manager's `<cite id="…">(Author, 2003)</cite>`, whose
 * id needs the markdown-comment mapping, and cite2c's empty `<cite data-cite="…"></cite>`,
 * whose attribute is the item id itself (JDH-080).
 */
const CITE_PATTERN = '<cite\\s+(id|data-cite)="([^"]+)"[^>]*>([\\s\\S]*?)<\\/cite>';

/** A character markdown won't contain, standing in for a blanked-out `<cite>` element. */
const CITE_MASK = '';

/**
 * `md` with every `<cite>` element blanked out, keeping its length, so a scan for the
 * author's own parentheses isn't thrown off by parentheses in the citation's own text.
 */
function maskCites(md: string): string {
  return md.replace(new RegExp(CITE_PATTERN, 'g'), (m) => CITE_MASK.repeat(m.length));
}

/**
 * APA separates the works in a parenthesised group with a semicolon, and a citation
 * holds commas of its own, so a group the author separated with commas —
 * `(<cite/>, <cite/>)` — reads wrongly once the citations are rendered (JDH-076).
 * Replacement is the same length, so offsets into the result still match `md`.
 */
function normalizeCiteGroupSeparators(md: string): string {
  const masked = maskCites(md);
  const re = new RegExp(`\\(([${CITE_MASK}\\s,;]*)\\)`, 'g');
  let out = md;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const inside = m[1];
    if (!inside.includes(CITE_MASK) || !inside.includes(',')) continue;
    // Only the separators, which are the commas the mask left visible — a comma inside a
    // citation's own text ("(Boisvert, 2000)") sits under the mask and must stay.
    const start = m.index + 1;
    // split('') not [...], so the indices stay UTF-16 code units, as `inside`'s are.
    const chars = out.slice(start, start + inside.length).split('');
    for (let i = 0; i < inside.length; i++) if (inside[i] === ',') chars[i] = ';';
    out = out.slice(0, start) + chars.join('') + out.slice(start + inside.length);
  }
  return out;
}

/**
 * A locator the author put in beside the citation: "3", "p. 199", "p. iii",
 * "esp. pp. 205-10", "22 July 1997 vol 298 col 793". It has to open with a page marker,
 * a bare number, or a roman numeral after one, so ordinary prose ("and others") is not
 * swallowed; from there it runs to the closing bracket (JDH-080).
 */
const LOCATOR_PATTERN =
  '(?:esp\\.|cf\\.|see)?\\s*(?:(?:pp?\\.|chap\\.|sec\\.)\\s*[\\divxlcIVXLC]+|\\d+|(?:(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))|(?:(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})))[^()\\[\\]]*';

/**
 * True if the cite at `[start, end)` sits inside a pair of the author's own parentheses
 * holding nothing but citations, their separators and page locators, so its own
 * parentheses would nest. A parenthesised aside beside a citation — "(specific to
 * humans) (Compagno, 2025)" — is not such a group and keeps its brackets, and neither is
 * a citation inside a longer parenthesised sentence.
 */
function inParenthesisedCiteGroup(masked: string, start: number, end: number): boolean {
  const open = masked.lastIndexOf('(', start);
  const close = masked.indexOf(')', end);
  if (open === -1 || close === -1) return false;
  const inside = new RegExp(`^(?:[${CITE_MASK}\\s,;]|${LOCATOR_PATTERN})*$`);
  return inside.test(masked.slice(open + 1, close));
}

/**
 * Rewrite citation-manager `<cite id>` elements to MyST citations.
 *
 * Keys come from the cell's citation-manager mapping; when that is empty (a
 * known plugin failure), from the Zotero item key in the citation's own link.
 * Citations that still can't be resolved become their visible text and are
 * returned in `unresolved`.
 */
/**
 * What may sit between citations inside one pair of the author's parentheses without
 * making it prose: separators, page locators and the short connectives authors use.
 */
const CITE_GROUP_FILLER =
  /^(?:[\s,;.-]|\u2013|and|see|also|cf\.|e\.g\.|i\.e\.|esp\.|pp?\.|chap\.|sec\.|vol\.|col\.|\d+)*$/i;

export function rewriteMdCitationsToMyst(
  md: string,
  citeIdToRefs: Map<string, CitationManagerRef[]>,
  keyForZoteroId: (zoteroId: string) => string | undefined,
): { md: string; unresolved: string[] } {
  const unresolved: string[] = [];

  const source = normalizeCiteGroupSeparators(md);
  const masked = maskCites(source);

  let out = source.replace(
    new RegExp(CITE_PATTERN, 'g'),
    (_full: string, attr: string, citeId: string, inner: string, offset: number) => {
      // cite2c puts the item id in the attribute; citation-manager's id needs the mapping.
      let ids: string[];
      if (attr === 'data-cite') {
        ids = [citeId];
      } else {
        const mapped = (citeIdToRefs.get(citeId) ?? [])
          .filter((r) => r && r.source === 'zotero' && r.id)
          .map((r) => r.id);
        ids = mapped.length ? mapped : zoteroIdsFromCiteHtml(inner);
      }
      const keys = [...new Set(ids.map(keyForZoteroId).filter((k): k is string => Boolean(k)))];
      if (keys.length) return `[${keys.map((k) => `@${k}`).join('; ')}]`;

      // A cite2c marker carries no text, so there is nothing to fall back to. Leave the
      // element alone rather than deleting it: an empty "()" would hide the problem.
      if (attr === 'data-cite') {
        unresolved.push(citeId);
        return _full;
      }

      let text = citeVisibleText(inner);
      unresolved.push(text || citeId);
      // Avoid "((Author, 2023))" when the article already wraps the citation — or the
      // whole group of citations — in parentheses.
      const wrapped = inParenthesisedCiteGroup(masked, offset, offset + _full.length);
      if (wrapped && /^\(.*\)$/.test(text)) text = text.slice(1, -1);
      return text;
    },
  );

  // Both separators: APA groups with a semicolon, and the author may have written either.
  out = out.replace(/\[@[^\]]+?\](?:\s*[,;]\s*\[@[^\]]+?\])+/g, (chunk) => {
    const keys: string[] = [];
    const re = /\[@([^\]]+?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk)) !== null) keys.push(m[1].trim());
    if (keys.length <= 1) return chunk;
    return `[@${keys.join('; @')}]`.replace(/@{2,}/g, '@');
  });

  out = out.replace(/\(\s*(\[@[^\]]+?\])\s*\)/g, '$1');

  // "([@key], pp. 50-52)" → "[@key, pp. 50-52]". MyST reads the tail as a citation
  // supplement, so the locator prints inside the citation's own parentheses instead of
  // leaving the author's wrapped around them (JDH-076). The comma is optional: cite2c
  // authors write "(<cite/> p. 203)" with none (JDH-080).
  out = out.replace(
    new RegExp(`\\(\\s*\\[@([^\\]]+?)\\]\\s*,?\\s*(${LOCATOR_PATTERN})\\s*\\)`, 'g'),
    (_m, keys: string, locator: string) => `[@${keys}, ${locator.trim()}]`,
  );

  // "([@a], 1085; [@b])", "([@a]; see also [@b; @c])": one pair of the author's
  // parentheses holding nothing but citations, their locators and short connecting words.
  // Lift the whole lot into a single MyST citation, so only its own parentheses print and
  // the author's are not left wrapped around them (JDH-080).
  out = out.replace(/\(([^()]*\[@[^()]*)\)/g, (full: string, inner: string) => {
    const betweenCitations = inner.replace(/\[@[^\]]*\]/g, ' ');
    if (!CITE_GROUP_FILLER.test(betweenCitations)) return full;
    // MyST reads only ";" between the keys of one citation: "@a and @b" makes it look for
    // a label that is not there, and Typst then refuses to build at all.
    const joined = inner.replace(/\]\s+and\s+\[@/g, ']; [@');
    return `[${joined.replace(/\[@([^\]]*)\]/g, '@$1')}]`;
  });

  // "(e.g. [@a; @b])" → "[e.g. @a; @b]". MyST prints the prefix inside the citation's own
  // parentheses, so the author's pair is not left wrapped around them. Only a short run of
  // words directly before the citation, with the bracket closing straight after, so a
  // longer parenthesised aside is left alone (JDH-080).
  out = out.replace(
    /\(\s*([A-Za-z][^()[\]]{0,38}?)\s+(\[@[^\]]+?\])\s*\)/g,
    (_full: string, prefix: string, cite: string) => `[${prefix} ${cite.slice(1)}`,
  );

  out = stripCitationManagerFromAllComments(out);

  return { md: out, unresolved };
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
  const log: string[] = ['Done.'];

  // Both notebook citation formats. No article carries both, but merging costs nothing
  // and keeps one code path for author-.bib matching (JDH-080).
  const zoteroItems = options.zotero === false ? {} : loadZoteroItemsFromNotebook(notebookPath);
  const cite2cItems = options.zotero === false ? {} : loadCite2cItemsFromNotebook(notebookPath);
  const notebookItems: Record<string, CslItem> = { ...zoteroItems, ...cite2cItems };
  if (options.zotero === false) log.push('- Zotero:   skipped (--no-zotero)');
  if (Object.keys(cite2cItems).length)
    log.push(`- cite2c:   ${Object.keys(cite2cItems).length} items from notebook metadata`);

  const authorBibs = loadAuthorBibEntries(cwd, listWorkdirAuthorBibFiles(cwd));
  for (const file of authorBibs.emptyFiles) {
    process.stdout.write(`Skipping ${file}: no BibTeX entries.\n`);
  }

  // The author's .bib wins when it describes the same work as a Zotero item.
  const authorKeyByZoteroId = new Map<string, string>();
  for (const [id, item] of Object.entries(notebookItems)) {
    const match = findAuthorEntry(
      { doi: extractDoi(item), title: item.title ?? null, year: getIssuedDateParts(item).year },
      authorBibs.entries,
    );
    if (match) {
      authorKeyByZoteroId.set(id, match.key);
      process.stdout.write(`Using ${match.file} entry ${match.key} for Zotero item ${id}.\n`);
    }
  }

  const ownItems = Object.fromEntries(
    Object.entries(notebookItems).filter(([id]) => !authorKeyByZoteroId.has(id)),
  );
  // These are machine keys; the next step ("Improve citekeys to author–year") turns them
  // into Allen2020 / BambraSmith2010 / BrownEtAl2020, the same for both formats.
  const citekeyByZoteroId = buildCitekeyMap(ownItems);
  const bibEntries = Object.keys(ownItems)
    .sort()
    .map((id) => {
      const citekey = citekeyByZoteroId.get(id)!;
      return renderBibtexEntry(pickBibtexType(ownItems[id]), citekey, buildBibtexFields(ownItems[id], citekey));
    });

  // An empty references.bib breaks myst build, so only write it when there are entries.
  const bibliography: string[] = [];
  if (bibEntries.length) {
    writeUtf8(
      bibPath,
      `% Generated from ${path.basename(notebookPath)} notebook metadata ` +
        `(${[Object.keys(zoteroItems).length ? 'citation-manager' : null, Object.keys(cite2cItems).length ? 'cite2c' : null].filter(Boolean).join(' + ')})\n` +
        `% Entries: ${bibEntries.length}\n\n` +
        bibEntries.join('\n'),
      options.dryRun,
    );
    bibliography.push(path.basename(bibPath));
    log.push(`- BibTeX:   ${path.relative(cwd, bibPath)} (${bibEntries.length} entries)`);
  } else if (!authorBibs.usableFiles.length) {
    log.push('- BibTeX:   no notebook citation items; references.bib not written');
  }
  bibliography.push(...authorBibs.usableFiles);
  if (authorBibs.usableFiles.length) {
    log.push(
      `- Author:   ${authorBibs.usableFiles.join(', ')} (${authorBibs.entries.length} entries; ${authorKeyByZoteroId.size} replace Zotero items)`,
    );
  }

  if (options.rewriteMd && fileExists(articlePath)) {
    const md = readUtf8(articlePath);
    const { md: rewritten, unresolved } = rewriteMdCitationsToMyst(
      md,
      extractCitationManagerMappingsFromMd(md),
      (id) => authorKeyByZoteroId.get(id) ?? citekeyByZoteroId.get(id),
    );
    if (rewritten !== md) {
      writeUtf8(articlePath, rewritten, options.dryRun);
      log.push(`- Rewrote:  ${path.relative(cwd, articlePath)}`);
    }
    if (unresolved.length) {
      process.stdout.write(
        `Warning: ${unresolved.length} citation(s) not found in any bibliography; kept as plain text: ` +
          `${unresolved.slice(0, 5).join('; ')}${unresolved.length > 5 ? '; …' : ''}\n`,
      );
    }
  }

  if (options.updateMyst && bibliography.length && fileExists(mystPath)) {
    for (const bib of bibliography) ensureMystBibliography(mystPath, bib, options.dryRun);
    log.push(`- Updated:  ${path.relative(cwd, mystPath)} (bibliography: ${bibliography.join(', ')})`);
  }

  if (options.dryRun) log.push('(dry-run: no files written)');
  console.log(log.join('\n'));
}

/**
 * Export Zotero items from notebook citation-manager metadata to `references.bib`,
 * rewrite `<cite>` tags in markdown to MyST citations, and link the bib in myst.yml.
 */
export const citationsJupyterZoteroStep: PipelineStep = {
  id: 'citationsJupyterZotero',
  label: 'Extract citations + BibTeX + rewrite markdown (Zotero and author .bib)',
  inputs: ['ipynb', 'markdown', 'myst', 'bibtex'],
  // Run for notebooks (Zotero items) and for repos that bring their own .bib.
  when: (ctx) => (listProjectBibFiles(ctx.projectRoot).length ? 'run' : whenNotebook(ctx)),
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
      zotero: ctx.options.zotero,
      cwd: o.cwd,
    });
  },
};
