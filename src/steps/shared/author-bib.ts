import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@retorquere/bibtex-parser';

/**
 * Author-supplied BibTeX files (e.g. `direct.bib`) in the article repo.
 *
 * They are copied into the workdir verbatim and registered in myst.yml; this
 * module only reads them to match Zotero items against their entries.
 */

/** Name the pipeline gives its own Zotero-generated bibliography. */
export const GENERATED_BIB = 'references.bib';
/** Workdir name for an author file that is itself called references.bib. */
export const AUTHOR_REFERENCES_BIB = 'references.author.bib';

export interface AuthorBibEntry {
  key: string;
  file: string;
  doi: string | null;
  title: string | null;
  year: string | null;
}

/** Workdir file name for an author .bib from the project root. */
export function authorBibWorkdirName(fileName: string): string {
  return fileName === GENERATED_BIB ? AUTHOR_REFERENCES_BIB : fileName;
}

/** `.bib` files in the project root (author-supplied). */
export function listProjectBibFiles(projectRoot: string): string[] {
  if (!fs.existsSync(projectRoot)) return [];
  return fs
    .readdirSync(projectRoot)
    .filter((name) => name.toLowerCase().endsWith('.bib'))
    .sort();
}

/** Author .bib files in the workdir (everything except the generated references.bib). */
export function listWorkdirAuthorBibFiles(workdir: string): string[] {
  return listProjectBibFiles(workdir).filter((name) => name !== GENERATED_BIB);
}

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fieldText(value: unknown): string | null {
  if (value == null) return null;
  const text = Array.isArray(value) ? value.join(' ') : String(value);
  return text.trim() || null;
}

/** Parse entries from author .bib files in `workdir`. Files without entries are reported, not returned. */
export function loadAuthorBibEntries(
  workdir: string,
  files: string[],
): { entries: AuthorBibEntry[]; usableFiles: string[]; emptyFiles: string[] } {
  const entries: AuthorBibEntry[] = [];
  const usableFiles: string[] = [];
  const emptyFiles: string[] = [];
  for (const file of files) {
    const parsed = parse(fs.readFileSync(path.join(workdir, file), 'utf8'));
    if (!parsed.entries.length) {
      emptyFiles.push(file);
      continue;
    }
    usableFiles.push(file);
    for (const e of parsed.entries) {
      const fields = e.fields as Record<string, unknown>;
      const doi = fieldText(fields.doi);
      const date = fieldText(fields.year) ?? fieldText(fields.date);
      entries.push({
        key: e.key,
        file,
        doi: doi ? normalizeDoi(doi) : null,
        title: fieldText(fields.title),
        year: date?.match(/\d{4}/)?.[0] ?? null,
      });
    }
  }
  return { entries, usableFiles, emptyFiles };
}

/** The author entry describing the same work, matched by DOI, else by title and year. */
export function findAuthorEntry(
  work: { doi: string | null; title: string | null; year: string | null },
  entries: readonly AuthorBibEntry[],
): AuthorBibEntry | null {
  if (work.doi) {
    const doi = normalizeDoi(work.doi);
    const byDoi = entries.find((e) => e.doi === doi);
    if (byDoi) return byDoi;
  }
  if (work.title && work.year) {
    const title = normalizeTitle(work.title);
    const byTitle = entries.find(
      (e) => e.title && e.year === work.year && normalizeTitle(e.title) === title,
    );
    if (byTitle) return byTitle;
  }
  return null;
}
