import { describe, expect, test } from 'bun:test';
import {
  buildTypstTableWrap,
  replaceTableWithTypstWrap,
  stringToTypstText,
  tableNodeToTypst,
  typstCell,
} from '../templates/plugins/jdh-table.mjs';

function makeTableNode() {
  return {
    type: 'table',
    align: 'center',
    children: [
      {
        type: 'tableRow',
        header: true,
        children: [
          { type: 'tableCell', children: [{ type: 'text', value: 'A * bold' }] },
          { type: 'tableCell', children: [{ type: 'text', value: 'B # hash' }] },
        ],
      },
      {
        type: 'tableRow',
        children: [
          {
            type: 'tableCell',
            children: [{ type: 'text', value: 'x \\ y [br] $ @ _ ` < > = ~' }],
          },
          { type: 'tableCell', children: [{ type: 'inlineCode', value: 'code`tick' }] },
        ],
      },
    ],
  };
}

describe('jdh-table Typst serialization', () => {
  test('typstCell escapes myst-to-typst special characters', () => {
    expect(typstCell('')).toBe('[]');
    expect(typstCell('plain')).toBe('[plain]');
    expect(typstCell('* # \\ [ ] $ @ _ ` < > = ~')).toBe(
      '[\\* \\# \\\\ \\[ \\] \\$ \\@ \\_ \\` \\< \\> \\= $tilde$]',
    );
  });

  test('stringToTypstText mirrors core myst-to-typst escaping', () => {
    expect(stringToTypstText('a\\b')).toBe('a\\\\b');
    expect(stringToTypstText('~')).toBe('$tilde$');
    expect(stringToTypstText('&')).toBe('\\&');
  });

  test('tableNodeToTypst emits tablex with columns, header-rows, and escaped cells', () => {
    const table = makeTableNode();
    const typst = tableNodeToTypst(table, 2);

    expect(typst).toContain('#let jdh-ts = jdh-table-style(header-rows: 1, hidden-rows: 2, data-rows: 1)');
    expect(typst).toContain('#tablex(columns: (1fr, 1fr), header-rows: 1, repeat-header: true, ..jdh-ts,');
    expect(typst).toContain('[A \\* bold],');
    expect(typst).toContain('[B \\# hash],');
    expect(typst).toContain('[x \\\\ y \\[br\\] \\$ \\@ \\_ \\` \\< \\> \\= $tilde$],');
    expect(typst).toContain('[code\\`tick],');
    expect(typst).toContain('jdh-table-more-cell(2, 2),');
    expect(typst.endsWith(')\n')).toBe(true);
  });

  test('buildTypstTableWrap wraps tablex in enter/shell/leave and one raw child div', () => {
    const wrap = buildTypstTableWrap(makeTableNode(), 1, 0);
    const raw = wrap.children[0];

    expect(wrap.type).toBe('div');
    expect(wrap.children).toHaveLength(1);
    expect(raw.type).toBe('raw');
    expect(raw.typst).toContain('#jdh-table-enter(hidden-rows: 1, hidden-cols: 0)');
    expect(raw.typst).toContain('#jdh-table-shell[');
    expect(raw.typst).toContain('#tablex(columns: (1fr, 1fr), header-rows: 1');
    expect(raw.typst).toContain(']');
    expect(raw.typst).toContain('#jdh-table-leave()');
  });

  test('replaceTableWithTypstWrap swaps nested table for typst div wrap', () => {
    const table = makeTableNode();
    const wrap = buildTypstTableWrap(table, 0, 0);
    const children = [
      { type: 'caption', children: [] },
      { type: 'paragraph', children: [] },
      table,
    ];

    expect(replaceTableWithTypstWrap(children, wrap)).toBe(true);
    expect(children[0].type).toBe('caption');
    expect(children[1].type).toBe('paragraph');
    expect(children[2]).toBe(wrap);
    expect(children[2].children[0].type).toBe('raw');
  });
});
