import { describe, expect, test } from 'bun:test';
import plugin from '../templates/plugins/jdh-table.mjs';

const jdhTable = plugin.directives[0];

describe('jdh-table directive', () => {
  test('emits caption and label like myst table directive', () => {
    const [container] = jdhTable.run({
      arg: [{ type: 'text', value: 'Example caption.' }],
      body: [{ type: 'table', children: [] }],
      options: { label: 'table:1', align: 'center' },
    });

    expect(container.type).toBe('container');
    expect(container.kind).toBe('table');
    expect(container.identifier).toBe('table:1');
    expect(container.children[0].type).toBe('caption');
    expect(container.children[0].children[0].type).toBe('paragraph');
    expect(container.children[1].type).toBe('table');
    expect(container.data?.jdhTable).toBe(true);
  });

  test('stores max-columns in jdhTableOptions', () => {
    const [container] = jdhTable.run({
      arg: [{ type: 'text', value: 'Caption.' }],
      body: [{ type: 'table', children: [] }],
      options: { label: 'table:3', 'max-columns': 8 },
    });

    expect(container.data?.jdhTableOptions?.['max-columns']).toBe(8);
  });

  test('supports enumeration options', () => {
    const [container] = jdhTable.run({
      arg: [{ type: 'text', value: 'Caption.' }],
      body: [{ type: 'table', children: [] }],
      options: { label: 'table:2', enumerator: '2.' },
    });

    expect(container.enumerator).toBe('2.');
  });
});

describe('jdh-table total-rows', () => {
  const transform = plugin.transforms[0];
  const cell = (value: string) => ({ type: 'tableCell', children: [{ type: 'text', value }] });
  const row = (values: string[], header = false) => ({
    type: 'tableRow',
    ...(header ? { header: true } : {}),
    children: values.map(cell),
  });

  function build(options: Record<string, unknown>) {
    const [container] = jdhTable.run({
      arg: [{ type: 'text', value: 'Caption.' }],
      body: [{ type: 'table', children: [row(['h'], true), ...['1', '2', '3', '4', '5', '6'].map((v) => row([v]))] }],
      options: { label: 'table:9', ...options },
    });
    const tree = { type: 'root', children: [container] };
    transform.plugin({}, { selectAll: () => [container] })(tree);
    return container.data.jdhTableMeta.hiddenRows;
  }

  test('without total-rows, hidden rows count the body only', () => {
    expect(build({})).toBe(2);
  });

  test('total-rows counts rows already cut from a pandas output', () => {
    expect(build({ 'total-rows': 260 })).toBe(256);
  });
});
