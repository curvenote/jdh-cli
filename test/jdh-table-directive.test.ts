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

  test('supports enumeration options', () => {
    const [container] = jdhTable.run({
      arg: [{ type: 'text', value: 'Caption.' }],
      body: [{ type: 'table', children: [] }],
      options: { label: 'table:2', enumerator: '2.' },
    });

    expect(container.enumerator).toBe('2.');
  });
});
