/**
 * Shared helpers for MyST document parts (written into page frontmatter via yaml-doc).
 * Used by jupytext region extraction and (future) heading-based extraction.
 */

/**
 * Known MyST "document parts" (including aliases).
 *
 * Source: https://mystmd.org/guide/document-parts#known-document-parts
 */
export const KNOWN_MYST_PARTS = new Set<string>([
  'abstract',
  'summary',
  'plain_language_summary',
  'lay_summary',
  'keypoints',
  'dedication',
  'epigraph',
  'quote',
  'data_availability',
  'availability',
  'acknowledgments',
  'ack',
  'acknowledgements',
]);

export function partitionPartsByKind(
  parts: Record<string, string>,
): { knownParts: Record<string, string>; customParts: Record<string, string> } {
  const knownParts: Record<string, string> = {};
  const customParts: Record<string, string> = {};

  for (const [key, content] of Object.entries(parts)) {
    if (KNOWN_MYST_PARTS.has(key)) knownParts[key] = content;
    else customParts[key] = content;
  }

  return { knownParts, customParts };
}

/** Remove line intervals from a markdown body (e.g. stripped region blocks). */
export function removeBodyLineIntervals(
  bodyLines: string[],
  intervals: Array<{ start: number; end: number }>,
): string[] {
  if (!intervals.length) return bodyLines;

  const ints = intervals
    .map((x) => ({ start: x.start, end: x.end }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const it of ints) {
    const last = merged[merged.length - 1];
    if (!last || it.start > last.end + 1) merged.push({ start: it.start, end: it.end });
    else last.end = Math.max(last.end, it.end);
  }

  const out: string[] = [];
  let cursor = 0;
  for (const it of merged) {
    out.push(...bodyLines.slice(cursor, it.start));
    cursor = it.end + 1;
  }
  out.push(...bodyLines.slice(cursor));
  return out;
}

/** Rebuild `article.md` with updated frontmatter parts and body lines. */