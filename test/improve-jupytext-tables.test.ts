import { describe, expect, test } from 'bun:test';
import { processArticle } from '../src/steps/jupytext/improve-jupytext-tables.js';

describe('improve jupytext tables', () => {
  test('wraps table regions in jdh-table directives', () => {
    const input = [
      'See [Table 1](#table-1-*).',
      '',
      '<!-- #region jdh={"module": "object", "object": {"source": ["Table 1: Example caption."], "type": "image"}} tags=["table-1", "table-1-*"] -->',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '<!-- #endregion -->',
    ].join('\n');

    const { content } = processArticle(input);

    expect(content).toContain(':::{jdh-table} Example caption.');
    expect(content).toContain(':label: table:1');
    expect(content).not.toContain(':::{table}');
    expect(content).toContain('[](#table:1)');
    expect(content).not.toContain('table-1-*');
  });

  test('rewrites Table N prose references to label links', () => {
    const input = [
      'Table 1 shows values.',
      '',
      '<!-- #region jdh={"module": "object", "object": {"source": ["Table 1: Caption."], "type": "image"}} tags=["table:1"] -->',
      '| x |',
      '| --- |',
      '| 1 |',
      '<!-- #endregion -->',
    ].join('\n');

    const { content } = processArticle(input);

    expect(content).toContain('[](#table:1) shows values.');
  });
});
