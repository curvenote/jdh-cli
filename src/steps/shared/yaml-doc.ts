import fs from 'node:fs';
import { Document, parseDocument, stringify } from 'yaml';

/**
 * YAML read/write helpers. Config files are edited as YAML documents (keeping
 * comments and key order) instead of by string and indentation manipulation.
 */

const STRINGIFY_OPTIONS = { lineWidth: 0 } as const;

/** Serialize a plain object as YAML, with an optional leading comment. */
export function toYaml(value: unknown, comment?: string): string {
  if (!comment) return stringify(value, STRINGIFY_OPTIONS);
  const doc = new Document(value);
  doc.commentBefore = ` ${comment}`;
  return doc.toString(STRINGIFY_OPTIONS);
}

export function readYamlDocument(filePath: string): Document {
  const doc = parseDocument(fs.readFileSync(filePath, 'utf8'));
  if (doc.errors.length) {
    throw new Error(`Invalid YAML in ${filePath}: ${doc.errors[0].message}`);
  }
  return doc;
}

/** Plain JS value of a YAML file (or undefined when the file is empty). */
export function readYaml<T = unknown>(filePath: string): T {
  return readYamlDocument(filePath).toJS() as T;
}

/**
 * Edit a YAML file in place: `edit` mutates the document (setIn, deleteIn, …).
 * Returns true when the file content changed. Nothing is written on a dry run.
 */
export function updateYamlFile(
  filePath: string,
  edit: (doc: Document) => void,
  dryRun = false,
): boolean {
  const before = fs.readFileSync(filePath, 'utf8');
  const doc = readYamlDocument(filePath);
  edit(doc);
  const after = doc.toString(STRINGIFY_OPTIONS);
  if (after === before) return false;
  if (!dryRun) fs.writeFileSync(filePath, after);
  return true;
}

export interface MarkdownWithFrontmatter {
  /** Parsed frontmatter document (empty map when the file has none). */
  doc: Document;
  body: string;
}

/** Split `---` YAML frontmatter from a markdown file. */
export function parseMarkdownFrontmatter(md: string): MarkdownWithFrontmatter {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { doc: new Document({}), body: md };
  const doc = parseDocument(m[1]);
  if (doc.errors.length) throw new Error(`Invalid frontmatter YAML: ${doc.errors[0].message}`);
  return { doc, body: md.slice(m[0].length) };
}

/** Join frontmatter and body back into markdown (no frontmatter block when it's empty). */
export function stringifyMarkdownFrontmatter({ doc, body }: MarkdownWithFrontmatter): string {
  const json = doc.toJS();
  if (json == null || (typeof json === 'object' && Object.keys(json).length === 0)) return body;
  return `---\n${doc.toString(STRINGIFY_OPTIONS)}---\n${body}`;
}
