/**
 * MyST plugin: `jdh-table` directive for pipeline-produced tables.
 *
 * Parses GFM tables inside `:::{jdh-table}`, truncates rows/columns, and emits
 * a single Typst `raw` block (inside a one-child `div`) so myst-to-typst keeps
 * the table as one figure child while `#tablex` runs in code mode.
 *
 * Refs: https://mystmd.org/guide/javascript-plugins
 */

import {
  DEFAULT_MAX_COLUMNS,
  DEFAULT_MAX_ROWS,
  parseGfmTable,
  truncateTable,
} from './lib/table-truncate.mjs';

const jdhTableDirective = {
  name: 'jdh-table',
  doc: 'JDH table with row/column truncation and Typst styling. Emitted by improveJupytextTables.',
  arg: {
    type: 'String',
    doc: 'Table caption (no "Table N:" prefix; numbering is automatic).',
  },
  options: {
    label: { type: String, required: true },
    'max-rows': { type: Number, required: false },
    'header-rows': { type: Number, required: false },
    align: { type: String, required: false },
  },
  body: {
    type: 'myst',
    doc: 'GFM table body.',
  },
  run(data) {
    const opts = data.options ?? {};
    return [
      {
        type: 'container',
        kind: 'table',
        label: opts.label,
        identifier: opts.label,
        children: data.body ?? [],
        data: {
          jdhTable: true,
          jdhTableOptions: opts,
          jdhTableCaption: data.arg ?? '',
        },
      },
    ];
  },
};

function childText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  if (node.type === 'inlineCode') return node.value ?? '';
  if (Array.isArray(node.children)) return node.children.map(childText).join('');
  return '';
}

function findTableNode(nodes) {
  for (const node of nodes ?? []) {
    if (node?.type === 'table') return node;
    const nested = findTableNode(node?.children);
    if (nested) return nested;
  }
  return null;
}

function tableNodeToGfm(tableNode) {
  const headerRows = [];
  const dataRows = [];

  function addRow(row, asHeader) {
    if (row?.type !== 'tableRow') return;
    const cells = (row.children ?? [])
      .filter((cell) => cell.type === 'tableCell')
      .map(childText);
    if (asHeader) headerRows.push(cells);
    else dataRows.push(cells);
  }

  for (const child of tableNode.children ?? []) {
    if (child.type === 'tableRow') {
      addRow(child, child.header === true);
    } else if (child.type === 'thead' || child.type === 'tableHeader') {
      for (const row of child.children ?? []) addRow(row, true);
    } else if (Array.isArray(child.children)) {
      for (const row of child.children) addRow(row, false);
    }
  }

  return { headerRows, dataRows };
}

function collectMarkdownLines(children) {
  const lines = [];
  function walk(nodes) {
    for (const node of nodes ?? []) {
      if (node.type === 'text' && node.value?.includes('|')) {
        for (const line of node.value.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.includes('|')) lines.push(trimmed);
        }
      }
      walk(node.children);
    }
  }
  walk(children);
  return lines.join('\n');
}

function resolveTableGfm(children, headerRowsOpt) {
  const tableNode = findTableNode(children);
  let gfm = tableNode ? tableNodeToGfm(tableNode) : null;

  if (!gfm || gfm.headerRows.length + gfm.dataRows.length === 0) {
    const markdown = collectMarkdownLines(children);
    if (!markdown) return null;
    gfm = parseGfmTable(markdown);
  }

  const allRows = [...gfm.headerRows, ...gfm.dataRows];
  if (headerRowsOpt !== undefined) {
    const n = Number(headerRowsOpt);
    if (n === 2 && gfm.headerRows.length === 1 && gfm.dataRows.length > 0) {
      return {
        headerRows: [...gfm.headerRows, gfm.dataRows[0]],
        dataRows: gfm.dataRows.slice(1),
      };
    }
    return { headerRows: allRows.slice(0, n), dataRows: allRows.slice(n) };
  }

  if (gfm.headerRows.length === 0 && gfm.dataRows.length > 0) {
    return { headerRows: allRows.slice(0, 1), dataRows: allRows.slice(1) };
  }

  return gfm;
}

function gfmToTableNode(gfm, align = 'center') {
  const makeCell = (text) => ({
    type: 'tableCell',
    children: text ? [{ type: 'text', value: text }] : [],
  });
  const makeRow = (cells, header = false) => ({
    type: 'tableRow',
    ...(header ? { header: true } : {}),
    children: cells.map(makeCell),
  });

  const rows = [
    ...gfm.headerRows.map((cells) => makeRow(cells, true)),
    ...gfm.dataRows.map((cells) => makeRow(cells, false)),
  ];

  return { type: 'table', align, children: rows };
}

function isHeaderRow(row) {
  if (row?.type !== 'tableRow') return false;
  if (row.header === true) return true;
  const cells = (row.children ?? []).filter((child) => child.type === 'tableCell');
  return cells.length > 0 && cells.every((cell) => cell.header);
}

function countColumns(tableNode) {
  const firstRow = (tableNode.children ?? []).find((child) => child.type === 'tableRow');
  return (firstRow?.children ?? [])
    .filter((cell) => cell.type === 'tableCell')
    .reduce((total, cell) => total + (cell.colspan ?? 1), 0);
}

function countHeaderRows(tableNode) {
  return (tableNode.children ?? []).filter((child) => isHeaderRow(child)).length;
}

/** Escape cell text for Typst `[...]` tablex cells (mirrors myst-to-typst export). */
function typstCell(text) {
  if (!text) return '[]';
  const escaped = text.replace(/\\/g, '\\\\').replace(/#/g, '\\#');
  return `[${escaped}]`;
}

/** Serialize a table AST node to Typst `#tablex(...)` (for raw export inside figures). */
function tableNodeToTypst(tableNode) {
  const columns = countColumns(tableNode);
  const headerRows = countHeaderRows(tableNode);
  const rows = (tableNode.children ?? []).filter((child) => child.type === 'tableRow');
  let out = `#let jdh-ts = jdh-table-style(header-rows: ${headerRows})\n#tablex(columns: ${columns}, header-rows: ${headerRows}, repeat-header: true, ..jdh-ts,\n`;
  for (const row of rows) {
    for (const cell of (row.children ?? []).filter((child) => child.type === 'tableCell')) {
      out += `${typstCell(childText(cell))},\n`;
    }
  }
  out += ')\n';
  return out;
}

/**
 * Replace table content with a single-child `div` wrapping one `raw` Typst block.
 * myst-to-typst treats a lone table child as code-mode export; the `div` keeps
 * enter/table/footer as one figure child while `#`-prefixed raw Typst executes.
 */
function replaceTableWithTypstWrap(children, tableNode, hiddenRows, hiddenCols) {
  const tableTypst = tableNodeToTypst(tableNode).trim();
  const typst = [
    `#jdh-table-enter(hidden-rows: ${hiddenRows}, hidden-cols: ${hiddenCols})`,
    '#jdh-table-body[',
    tableTypst,
    ']',
    '#jdh-table-footer()',
  ].join('\n');
  const wrap = {
    type: 'div',
    children: [{ type: 'raw', typst: `${typst}\n` }],
  };

  for (let i = 0; i < (children ?? []).length; i++) {
    if (children[i].type === 'table') {
      children[i] = wrap;
      return true;
    }
    if (children[i].children && replaceTableWithTypstWrap(children[i].children, tableNode, hiddenRows, hiddenCols)) {
      return true;
    }
  }
  return false;
}

function processJdhTableContainer(node) {
  if (node.data?.jdhTableProcessed) return;

  const opts = node.data?.jdhTableOptions ?? {};
  const maxRowsOpt = opts['max-rows'] ?? opts.maxRows;
  const maxRows = maxRowsOpt === undefined ? DEFAULT_MAX_ROWS : Number(maxRowsOpt);
  const headerRowsOpt = opts['header-rows'] ?? opts.headerRows;
  const align = opts.align ?? 'center';

  const parsed = resolveTableGfm(node.children, headerRowsOpt);
  if (!parsed) return;

  const { table: truncated, hiddenRows, hiddenCols } = truncateTable(parsed, {
    maxRows,
    maxColumns: DEFAULT_MAX_COLUMNS,
  });

  const newTable = gfmToTableNode(truncated, align);
  if (!replaceTableWithTypstWrap(node.children, newTable, hiddenRows, hiddenCols)) {
    const tableTypst = tableNodeToTypst(newTable).trim();
    node.children = [
      {
        type: 'div',
        children: [
          {
            type: 'raw',
            typst: [
              `#jdh-table-enter(hidden-rows: ${hiddenRows}, hidden-cols: ${hiddenCols})`,
              '#jdh-table-body[',
              tableTypst,
              ']',
              '#jdh-table-footer()',
            ].join('\n') + '\n',
          },
        ],
      },
    ];
  }

  node.data = {
    ...(node.data ?? {}),
    jdhTableProcessed: true,
    jdhTableMeta: { hiddenRows, hiddenCols },
  };
}

const wrapJdhTableForTypst = {
  name: 'wrap-jdh-table-for-typst',
  stage: 'document',
  plugin: (_, utils) => (tree) => {
    utils.selectAll('container', tree).forEach((node) => {
      if (node.kind !== 'table' || !node.data?.jdhTable) return;
      processJdhTableContainer(node);
    });
  },
};

const plugin = {
  name: 'JDH Table',
  directives: [jdhTableDirective],
  transforms: [wrapJdhTableForTypst],
};

export default plugin;
