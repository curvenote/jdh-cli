import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { listWorkdirAuthorBibFiles, loadAuthorBibEntries } from '../shared/author-bib.js';
import { whenReferencesBib } from '../shared/when.js';


interface RunImproveCitationTagsOptions {
  bib?: string;
  article?: string;
  dryRun: boolean;
  cwd: string;
}

interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
  raw: string;
  start: number;
  end: number;
}

function readUtf8(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function writeUtf8(p: string, content: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.writeFileSync(p, content, 'utf8');
}

/**
 * Parse a BibTeX file into entries.
 *
 * This parser is intentionally minimal and aimed at the `.bib` shape produced by
 * `extract-citations-and-bib.ts`:
 * - entries look like `@type{key, ...fields... }`
 * - fields are typically `name = {value},`
 * - braces inside values are escaped as `\{` and `\}`, so nesting is simple.
 *
 * It will work on many BibTeX files, but it is not a fully compliant BibTeX parser.
 */
function parseBibtexEntries(bibText: string): BibEntry[] {
  const entries: BibEntry[] = [];

  let i = 0;
  while (i < bibText.length) {
    const at = bibText.indexOf('@', i);
    if (at === -1) break;

    const brace = bibText.indexOf('{', at);
    if (brace === -1) break;

    const type = bibText.slice(at + 1, brace).trim();
    if (!type || !/^[A-Za-z]+$/.test(type)) {
      i = at + 1;
      continue;
    }

    let depth = 0;
    let end = -1;

    for (let j = brace; j < bibText.length; j++) {
      const ch = bibText[j];
      const prev = j > 0 ? bibText[j - 1] : '';

      if (ch === '{' && prev !== '\\') depth++;
      if (ch === '}' && prev !== '\\') depth--;

      if (depth === 0) {
        end = j + 1;
        break;
      }
    }

    if (end === -1) break;

    const raw = bibText.slice(at, end);
    const headerMatch = raw.match(/^@([A-Za-z]+)\{([^,]+),/);
    if (!headerMatch) {
      i = end;
      continue;
    }

    const key = headerMatch[2].trim();
    const fields = parseBibtexFields(raw);

    entries.push({ type: headerMatch[1], key, fields, raw, start: at, end });
    i = end;
  }

  return entries;
}

/** Parse `name = {value}` fields from a BibTeX entry (best-effort). */
function parseBibtexFields(entryRaw: string): Record<string, string> {
  const fields: Record<string, string> = {};

  const re = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*\{([\s\S]*?)\}\s*,?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(entryRaw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2];
    fields[name] = value;
  }
  return fields;
}

/** Build a citation appearance order map from `article.md`. */
function getCitationFirstUsePositions(articleMd: string): Map<string, number> {
  const pos = new Map<string, number>();
  const re = /@([A-Za-z0-9_:-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(articleMd)) !== null) {
    const key = m[1];
    if (!pos.has(key)) pos.set(key, m.index);
  }
  return pos;
}

function normalizeKeyToken(s: string): string {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .trim();
}

function extractFamilyNames(authorField: string | undefined): string[] {
  if (!authorField) return [];
  const parts = authorField.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const families: string[] = [];
  for (const p of parts) {
    if (p.includes(',')) {
      families.push(p.split(',')[0].trim());
    } else {
      const words = p.split(/\s+/).filter(Boolean);
      if (words.length) families.push(words[words.length - 1]);
    }
  }
  return families;
}

function generateAuthorYearBaseKey(entry: BibEntry): string {
  const yearRaw = entry.fields.year ? String(entry.fields.year).trim() : '';
  const year = normalizeKeyToken(yearRaw) || 'nd';

  const authorFamilies = extractFamilyNames(entry.fields.author);
  const editorFamilies = authorFamilies.length ? [] : extractFamilyNames(entry.fields.editor);
  const families = authorFamilies.length ? authorFamilies : editorFamilies;

  if (families.length) {
    const f1 = normalizeKeyToken(families[0]) || 'Anon';
    if (families.length === 1) return `${f1}${year}`;
    if (families.length === 2) {
      const f2 = normalizeKeyToken(families[1]) || 'Anon';
      return `${f1}${f2}${year}`;
    }
    return `${f1}EtAl${year}`;
  }

  const title = entry.fields.title ? String(entry.fields.title) : '';
  const firstWord = normalizeKeyToken(title.split(/\s+/)[0] || '') || 'Untitled';
  return `${firstWord}${year}`;
}

function buildImprovedKeyMap(
  entries: BibEntry[],
  citationPositions: Map<string, number>,
  /** Keys already taken by other bibliographies (author .bib files). */
  reservedKeys: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const byBase = new Map<string, { entry: BibEntry; base: string }[]>();

  for (const e of entries) {
    const base = generateAuthorYearBaseKey(e);
    const arr = byBase.get(base) ?? [];
    arr.push({ entry: e, base });
    byBase.set(base, arr);
  }

  const keyMap = new Map<string, string>();
  const globallyUsed = new Set<string>(reservedKeys);

  const bases = Array.from(byBase.keys()).sort((a, b) => a.localeCompare(b));
  for (const base of bases) {
    const group = byBase.get(base) ?? [];

    group.sort((a, b) => {
      const pa = citationPositions.get(a.entry.key);
      const pb = citationPositions.get(b.entry.key);
      const aPos = typeof pa === 'number' ? pa : Number.POSITIVE_INFINITY;
      const bPos = typeof pb === 'number' ? pb : Number.POSITIVE_INFINITY;
      if (aPos !== bPos) return aPos - bPos;

      const ta = (a.entry.fields.title ?? '').toLowerCase();
      const tb = (b.entry.fields.title ?? '').toLowerCase();
      if (ta !== tb) return ta.localeCompare(tb);
      return a.entry.key.localeCompare(b.entry.key);
    });

    if (group.length === 1) {
      let candidate = base;
      candidate = ensureUnique(candidate, globallyUsed);
      keyMap.set(group[0].entry.key, candidate);
      globallyUsed.add(candidate);
      continue;
    }

    for (let idx = 0; idx < group.length; idx++) {
      const suffix = String.fromCharCode('a'.charCodeAt(0) + idx);
      let candidate = `${base}${suffix}`;
      candidate = ensureUnique(candidate, globallyUsed);
      keyMap.set(group[idx].entry.key, candidate);
      globallyUsed.add(candidate);
    }
  }

  return keyMap;
}

function ensureUnique(key: string, used: Set<string>): string {
  if (!used.has(key)) return key;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${key}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not de-duplicate citekey: ${key}`);
}

function rewriteBibtexKeys(
  bibText: string,
  entries: BibEntry[],
  keyMap: Map<string, string>,
): string {
  const out: string[] = [];
  let cursor = 0;

  for (const e of entries) {
    out.push(bibText.slice(cursor, e.start));
    const newKey = keyMap.get(e.key) ?? e.key;
    if (newKey === e.key) {
      out.push(e.raw);
    } else {
      out.push(e.raw.replace(/^@([A-Za-z]+)\{([^,]+),/, `@$1{${newKey},`));
    }
    cursor = e.end;
  }

  out.push(bibText.slice(cursor));
  return out.join('');
}

function rewriteMarkdownCitations(articleMd: string, keyMap: Map<string, string>): string {
  return articleMd.replace(/@([A-Za-z0-9_:-]+)/g, (full, key) => {
    const mapped = keyMap.get(key);
    return mapped ? `@${mapped}` : full;
  });
}

/**
 * Improve BibTeX citation keys to human-friendly author–year keys,
 * and rewrite the article's MyST/pandoc citations to match.
 */
async function improveCitationTags(
  options: RunImproveCitationTagsOptions,
): Promise<void> {
  const bibPath = path.resolve(options.cwd, options.bib ?? 'references.bib');
  const articlePath = path.resolve(options.cwd, options.article ?? 'article.md');

  const bibText = readUtf8(bibPath);
  const entries = parseBibtexEntries(bibText);

  const articleMd = readUtf8(articlePath);
  const citationPositions = getCitationFirstUsePositions(articleMd);

  const authorKeys = new Set(
    loadAuthorBibEntries(options.cwd, listWorkdirAuthorBibFiles(options.cwd)).entries.map((e) => e.key),
  );
  const keyMap = buildImprovedKeyMap(entries, citationPositions, authorKeys);

  const newBibText = rewriteBibtexKeys(bibText, entries, keyMap);
  const newArticleMd = rewriteMarkdownCitations(articleMd, keyMap);

  const bibChanged = newBibText !== bibText;
  const articleChanged = newArticleMd !== articleMd;

  if (bibChanged) writeUtf8(bibPath, newBibText, options.dryRun);
  if (articleChanged) writeUtf8(articlePath, newArticleMd, options.dryRun);

  process.stdout.write(
    [
      'Done.',
      `- Bib:     ${path.relative(options.cwd, bibPath)} (${entries.length} entries)`,
      `- Article: ${path.relative(options.cwd, articlePath)}`,
      bibChanged ? '- Bib:     updated keys' : '- Bib:     no changes',
      articleChanged ? '- Article: updated citations' : '- Article: no changes',
      options.dryRun ? '(dry-run: no files written)' : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

/**
 * Rename BibTeX citekeys to author–year form and rewrite matching `@key`
 * citations in `article.md`.
 */
export const improveCitationTagsStep: PipelineStep = {
  id: 'improveCitationTags',
  label: 'Improve citekeys to author–year',
  inputs: ['markdown', 'bibtex'],
  when: whenReferencesBib,
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await improveCitationTags({
      bib: 'references.bib',
      article: 'article.md',
      dryRun: o.dryRun,
      cwd: o.cwd,
    });
  },
};
