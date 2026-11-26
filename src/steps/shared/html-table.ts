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
  /** Columns in the full table, from the same footer (JDH-045). */
  totalColumns: number | null;
  /** `<caption>` text, if any (pandas Styler `set_caption`). R's "A data.frame: …" is dropped. */
  caption: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
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
  const keep = Array.from(
    { length: width },
    (_, i) => !all.every((r) => ELLIPSIS.test(r[i] ?? '')),
  );
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
  return tablesFromHtml(html)[0] ?? null;
}

/**
 * Every `<table>` in an HTML output, in document order.
 *
 * One output can hold several tables: a cell that prints a side-by-side comparison emits
 * a single `text/html` with the tables inside a flex container, so iterating a cell's
 * *outputs* finds only one thing to render (JDH-086).
 */
export function tablesFromHtml(html: string): OutputTable[] {
  const out: OutputTable[] = [];
  for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const table = parseTableHtml(html, match[0], match.index ?? 0);
    if (table) out.push(table);
  }
  return out;
}

/** One `<table>`, with the footer and caption that belong to it. */
function parseTableHtml(html: string, tableHtml: string, offset: number): OutputTable | null {
  const theadHtml = tableHtml.match(/<thead\b[\s\S]*?<\/thead>/i)?.[0] ?? '';
  const headRows = theadHtml ? rowsOf(theadHtml).map((r) => r.cells) : [];
  const bodyRows = rowsOf(theadHtml ? tableHtml.replace(theadHtml, '') : tableHtml);
  // Without a <thead>, leading all-<th> rows are the header.
  while (!theadHtml && bodyRows.length > 1 && bodyRows[0].header)
    headRows.push(bodyRows.shift()!.cells);
  const table = {
    headerRows: headRows,
    dataRows: bodyRows.map((r) => r.cells).filter((r) => r.length),
  };
  if (!table.headerRows.length && !table.dataRows.length) return null;
  tidyHeaders(table);
  dropEllipses(table);
  dropRangeIndex(table);
  // The "N rows × M columns" footer pandas prints after a truncated table. With several
  // tables in one output, stop at the next one so a later footer is not read as this
  // table's.
  const after = html.slice(offset + tableHtml.length);
  const nextTable = after.search(/<table\b/i);
  const footer = (nextTable === -1 ? after : after.slice(0, nextTable)).match(
    /(\d[\d,]*)\s+rows\s+×\s+(\d[\d,]*)\s+columns/,
  );
  const captionText = htmlText(
    tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? '',
  );
  return {
    ...table,
    totalRows: footer ? parseInt(footer[1].replace(/,/g, ''), 10) : null,
    totalColumns: footer ? parseInt(footer[2].replace(/,/g, ''), 10) : null,
    caption: captionText && !/^A data\.frame:/i.test(captionText) ? captionText : null,
  };
}

/**
 * Join tables that are one table split for layout.
 *
 * A cell that lays several tables out side by side is usually chunking one series to fit
 * the page width — 5dfgdpiURy8S splits 2013-2024 into four blocks inside a flex container
 * (JDH-086). Identical header rows are the tell, and joining them back restores the table
 * the reader sees online. Tables whose headers differ are genuinely separate and are left
 * alone.
 *
 * Rows are concatenated as they stand: a value repeated at a chunk boundary is the
 * author's data and appears online too, so it is not deduplicated here.
 */
export function mergeChunkedTables(tables: readonly OutputTable[]): OutputTable[] {
  const sameHeader = (a: OutputTable, b: OutputTable) =>
    a.headerRows.length > 0 && JSON.stringify(a.headerRows) === JSON.stringify(b.headerRows);

  const out: OutputTable[] = [];
  for (const table of tables) {
    const last = out[out.length - 1];
    if (last && sameHeader(last, table)) {
      out[out.length - 1] = {
        ...last,
        dataRows: [...last.dataRows, ...table.dataRows],
        // A chunk's own footer counts only its own rows, so it cannot describe the join.
        totalRows: null,
        totalColumns: last.totalColumns ?? table.totalColumns,
        caption: last.caption ?? table.caption,
      };
      continue;
    }
    out.push(table);
  }
  return out;
}

/** The table in a `text/markdown` output (prose lines around it are ignored), or null. */
export function tableFromMarkdown(markdown: string): OutputTable | null {
  const lines = markdown.split('\n').map((l) => l.trim());
  const sep = lines.findIndex(
    (l, i) =>
      i > 0 && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(l) && lines[i - 1].includes('|'),
  );
  if (sep === -1) return null;
  const split = (l: string) =>
    l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => decodeEntities(c.replace(/\\\|/g, '|')).trim());
  const body: string[][] = [];
  for (const l of lines.slice(sep + 1)) {
    if (!l.includes('|')) break;
    body.push(split(l));
  }
  return {
    headerRows: [split(lines[sep - 1])],
    dataRows: body,
    totalRows: null,
    totalColumns: null,
    caption: null,
  };
}

/** Table from a cell's outputs: the first HTML `<table>`, else a markdown table. */
export function tableFromOutputs(
  outputs: readonly { text: Record<string, string> }[],
): OutputTable | null {
  return tablesFromOutputs(outputs)[0] ?? null;
}

/**
 * Every table a cell's outputs hold, in order.
 *
 * Covers both shapes the corpus has: one cell with several outputs, and one output
 * holding several tables (JDH-086). HTML wins over markdown, as a cell that emits both
 * is emitting two renderings of the same thing.
 */
export function tablesFromOutputs(
  outputs: readonly { text: Record<string, string> }[],
): OutputTable[] {
  const html = outputs.flatMap((o) =>
    o.text['text/html'] ? mergeChunkedTables(tablesFromHtml(o.text['text/html'])) : [],
  );
  if (html.length) return html;
  return outputs.flatMap((o) => {
    const t = o.text['text/markdown'] ? tableFromMarkdown(o.text['text/markdown']) : null;
    return t ? [t] : [];
  });
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
