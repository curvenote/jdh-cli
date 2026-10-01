/**
 * Read the table out of a notebook output (pandas, pandas Styler or R
 * data.frame HTML, or a markdown table) into rows of plain text, so it can be
 * written as a GFM table inside a `{jdh-table}` directive.
 *
 * Notebook table outputs have no row or column spans (checked across the JDH
 * corpus), so a small tag reader is enough; no HTML parser dependency.
 */

export interface OutputTable {
  /** Header rows; usually one. */
  headerRows: string[][];
  dataRows: string[][];
  /** Rows in the full table when the output is truncated (pandas `N rows × M columns` footer). */
  totalRows: number | null;
  /** `<caption>` text, if any (pandas Styler `set_caption`). R's "A data.frame: …" is dropped. */
  caption: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
function htmlText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function rowsOf(html: string): { cells: string[]; header: boolean }[] {
  const rows: { cells: string[]; header: boolean }[] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)(?=<\/?(?:th|td|tr)\b|$)/gi)];
    rows.push({
      cells: cells.map((c) => htmlText(c[2])),
      header: cells.length > 0 && cells.every((c) => c[1].toLowerCase() === 'th'),
    });
  }
  return rows;
}

const ELLIPSIS = /^(\.\.\.|…)$/;
const R_TYPE = /^<[a-z0-9]+>$/i;

/** Drop pandas' "..." truncation markers (whole rows, and columns that are "..." in every row). */
function dropEllipses(table: { headerRows: string[][]; dataRows: string[][] }): void {
  table.dataRows = table.dataRows.filter(
    (row) => !(row.some((c) => ELLIPSIS.test(c)) && row.every((c) => ELLIPSIS.test(c) || c === '')),
  );
  const all = [...table.headerRows, ...table.dataRows];
  const width = Math.max(0, ...all.map((r) => r.length));
  const keep = Array.from({ length: width }, (_, i) => !all.every((r) => ELLIPSIS.test(r[i] ?? '')));
  if (keep.every(Boolean)) return;
  const pick = (r: string[]) => r.filter((_, i) => keep[i]);
  table.headerRows = table.headerRows.map(pick);
  table.dataRows = table.dataRows.map(pick);
}

/**
 * Tidy pandas and R header rows:
 * - R data.frame: a second header row of column types (`<chr>`, `<int>`) is dropped.
 * - pandas named index: a second header row holding only the index name is merged into the first.
 */
function tidyHeaders(table: { headerRows: string[][]; dataRows: string[][] }): void {
  table.headerRows = table.headerRows.filter((row) => !row.every((c) => R_TYPE.test(c)));
  if (table.headerRows.length !== 2) return;
  const [first, second] = table.headerRows;
  if (first[0] === '' && second[0] && second.slice(1).every((c) => c === '')) {
    table.headerRows = [[second[0], ...first.slice(1)]];
  }
}

/** Drop pandas' default index column: blank header, then 0, 1, 2, … (gaps allowed where pandas truncated). */
function dropRangeIndex(table: { headerRows: string[][]; dataRows: string[][] }): void {
  const ids = table.dataRows.map((r) => (/^\d+$/.test(r[0] ?? '') ? +r[0] : NaN));
  const isRange = ids[0] === 0 && ids.every((n, i) => i === 0 || n > ids[i - 1]);
  if (!isRange || table.headerRows.some((r) => r[0] !== '')) return;
  table.headerRows = table.headerRows.map((r) => r.slice(1));
  table.dataRows = table.dataRows.map((r) => r.slice(1));
}

/** The first `<table>` in an HTML output, or null when there is none. */
export function tableFromHtml(html: string): OutputTable | null {
  const match = html.match(/<table\b[\s\S]*?<\/table>/i);
  if (!match) return null;
  const tableHtml = match[0];
  const theadHtml = tableHtml.match(/<thead\b[\s\S]*?<\/thead>/i)?.[0] ?? '';
  const headRows = theadHtml ? rowsOf(theadHtml).map((r) => r.cells) : [];
  const bodyRows = rowsOf(theadHtml ? tableHtml.replace(theadHtml, '') : tableHtml);
  // Without a <thead>, leading all-<th> rows are the header.
  while (!theadHtml && bodyRows.length > 1 && bodyRows[0].header) headRows.push(bodyRows.shift()!.cells);
  const table = { headerRows: headRows, dataRows: bodyRows.map((r) => r.cells).filter((r) => r.length) };
  if (!table.headerRows.length && !table.dataRows.length) return null;
  tidyHeaders(table);
  dropEllipses(table);
  dropRangeIndex(table);
  const footer = html.slice((match.index ?? 0) + tableHtml.length).match(/(\d[\d,]*)\s+rows\s+×\s+\d[\d,]*\s+columns/);
  const captionText = htmlText(tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? '');
  return {
    ...table,
    totalRows: footer ? parseInt(footer[1].replace(/,/g, ''), 10) : null,
    caption: captionText && !/^A data\.frame:/i.test(captionText) ? captionText : null,
  };
}

/** The table in a `text/markdown` output (prose lines around it are ignored), or null. */
export function tableFromMarkdown(markdown: string): OutputTable | null {
  const lines = markdown.split('\n').map((l) => l.trim());
  const sep = lines.findIndex((l, i) => i > 0 && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(l) && lines[i - 1].includes('|'));
  if (sep === -1) return null;
  const split = (l: string) =>
    l.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => decodeEntities(c.replace(/\\\|/g, '|')).trim());
  const body: string[][] = [];
  for (const l of lines.slice(sep + 1)) {
    if (!l.includes('|')) break;
    body.push(split(l));
  }
  return { headerRows: [split(lines[sep - 1])], dataRows: body, totalRows: null, caption: null };
}

/** Table from a cell's outputs: the first HTML `<table>`, else a markdown table. */
export function tableFromOutputs(outputs: readonly { text: Record<string, string> }[]): OutputTable | null {
  for (const o of outputs) {
    const t = o.text['text/html'] ? tableFromHtml(o.text['text/html']) : null;
    if (t) return t;
  }
  for (const o of outputs) {
    const t = o.text['text/markdown'] ? tableFromMarkdown(o.text['text/markdown']) : null;
    if (t) return t;
  }
  return null;
}

/** Escape text for a GFM table cell (backslash-escaped punctuation reads back as the same text). */
function gfmCell(text: string): string {
  return text.replace(/[\\`*_[\]<>|$~]/g, '\\$&');
}

/**
 * GFM for a `{jdh-table}` body. GFM allows one header row, so extra header rows
 * are written as the first body rows; pass `headerRows` as `:header-rows:`.
 */
export function outputTableToGfm(table: OutputTable): { markdown: string; headerRows: number } {
  const rows = [...table.headerRows, ...table.dataRows];
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (r: string[]) =>
    '| ' + Array.from({ length: width }, (_, i) => gfmCell(r[i] ?? '')).join(' | ') + ' |';
  const header = table.headerRows[0] ?? [];
  const markdown = [
    line(header),
    '| ' + Array(width).fill('---').join(' | ') + ' |',
    ...table.headerRows.slice(1).map(line),
    ...table.dataRows.map(line),
  ].join('\n');
  return { markdown, headerRows: Math.max(1, table.headerRows.length) };
}
