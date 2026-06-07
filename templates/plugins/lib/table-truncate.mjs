/** @typedef {{ headerRows: string[][], dataRows: string[][] }} GfmTable */

export const DEFAULT_MAX_ROWS = 4;
export const DEFAULT_MAX_COLUMNS = 6;

/** Split one GFM pipe row into cell strings. */
export function splitGfmRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  const parts = trimmed.split('|');
  if (parts[0]?.trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1]?.trim() === '') parts.pop();
  return parts.map((cell) => cell.trim());
}

/** True when the line is a GFM header/body separator (|---|---|). */
export function isSeparatorRow(line) {
  const cells = splitGfmRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * Parse a GFM markdown table string.
 * Rows before the first separator are header rows; rows after are data.
 * @param {string} markdown
 * @returns {GfmTable}
 */
export function parseGfmTable(markdown) {
  const lines = markdown
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes('|'));

  const sepIdx = lines.findIndex(isSeparatorRow);
  if (sepIdx < 0) {
    throw new Error('GFM table separator row not found');
  }

  const headerRows = lines.slice(0, sepIdx).map(splitGfmRow).filter((row) => row.length > 0);
  const dataRows = lines.slice(sepIdx + 1).map(splitGfmRow).filter((row) => row.length > 0);

  return { headerRows, dataRows };
}

/** @param {GfmTable} table */
export function serializeGfmTable(table) {
  const colCount = Math.max(
    0,
    ...table.headerRows.map((row) => row.length),
    ...table.dataRows.map((row) => row.length),
  );
  if (colCount === 0) return '';

  const formatRow = (row) => {
    const cells = [...row];
    while (cells.length < colCount) cells.push('');
    return '| ' + cells.join(' | ') + ' |';
  };

  const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
  return [...table.headerRows.map(formatRow), separator, ...table.dataRows.map(formatRow)].join(
    '\n',
  );
}

/**
 * @param {GfmTable} table
 * @param {{ maxRows?: number, headerRows?: number }} options
 */
export function truncateRows(table, options = {}) {
  const headerCount = options.headerRows ?? table.headerRows.length;
  const headers = table.headerRows.slice(0, headerCount);
  const data = table.dataRows;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  if (maxRows === 0 || data.length <= maxRows) {
    return {
      table: { headerRows: headers, dataRows: data },
      hiddenRows: 0,
    };
  }

  return {
    table: { headerRows: headers, dataRows: data.slice(0, maxRows) },
    hiddenRows: data.length - maxRows,
  };
}

/**
 * @param {GfmTable} table
 * @param {{ maxColumns?: number }} options
 */
export function truncateColumns(table, options = {}) {
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const allRows = [...table.headerRows, ...table.dataRows];
  const colCount = Math.max(0, ...allRows.map((row) => row.length));

  if (maxColumns <= 0 || colCount <= maxColumns) {
    return { table, hiddenCols: 0 };
  }

  const leftCount = Math.floor(maxColumns / 2);
  const rightCount = Math.floor(maxColumns / 2);

  const pickColumns = (row) => {
    if (row.length <= leftCount + rightCount) return [...row];
    return [...row.slice(0, leftCount), '…', ...row.slice(row.length - rightCount)];
  };

  return {
    table: {
      headerRows: table.headerRows.map(pickColumns),
      dataRows: table.dataRows.map(pickColumns),
    },
    hiddenCols: colCount - leftCount - rightCount,
  };
}

/**
 * @param {GfmTable} table
 * @param {{ maxRows?: number, maxColumns?: number, headerRows?: number }} options
 */
export function truncateTable(table, options = {}) {
  const rowResult = truncateRows(table, options);
  const colResult = truncateColumns(rowResult.table, options);
  return {
    table: colResult.table,
    hiddenRows: rowResult.hiddenRows,
    hiddenCols: colResult.hiddenCols,
  };
}

function looksLikeColumnHeaderRow(row) {
  return row.some((cell) => /\s/.test(cell) || (cell.length >= 4 && /[A-Za-z]/.test(cell)));
}

/**
 * Count header rows; handles pandas exports where row 2 is a dashed “separator”
 * between group headers and column names.
 * @param {string} markdown
 */
export function countHeaderRows(markdown) {
  const lines = markdown
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes('|'));
  const sepIdx = lines.findIndex(isSeparatorRow);
  if (sepIdx < 0) return 0;
  if (sepIdx === 1 && lines.length > 2 && looksLikeColumnHeaderRow(splitGfmRow(lines[2]))) {
    return 2;
  }
  return sepIdx;
}
