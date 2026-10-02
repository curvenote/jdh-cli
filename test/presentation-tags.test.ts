import { describe, expect, test } from 'bun:test';
import { processArticle as dropHidden } from '../src/steps/jupytext/drop-hidden-cells.js';
import { findJupytextCells } from '../src/steps/shared/jupytext-cells.js';

describe('findJupytextCells', () => {
  test('a fence inside a region belongs to the region', () => {
    const lines = ['<!-- #region tags=["a"] -->', '```python', 'x', '```', '<!-- #endregion -->', '', '```python tags=["b"]', 'y', '```'];
    expect(findJupytextCells(lines)).toEqual([
      { type: 'markdown', start: 0, end: 4, tags: ['a'] },
      { type: 'code', start: 6, end: 8, tags: ['b'] },
    ]);
  });
});

describe('dropHiddenCells', () => {
  test('hidden markdown and code cells go; the rest stays', () => {
    // Shapes from Chronoferencing (6ig87tC5GKjQ) and a hidden configuration cell.
    const md = [
      'Last paragraph.',
      '',
      '<!-- #region tags=["hidden"] -->',
      '## Bibliography',
      '<!-- #endregion -->',
      '',
      '<!-- #region tags=["hidden"] -->',
      '<div class="cite2c-biblio"></div>',
      '<!-- #endregion -->',
      '',
      '```python tags=["configuration", "hidden"]',
      'import os',
      '```',
      '',
      '<!-- #region tags=["hermeneutics"] -->',
      'Kept.',
      '<!-- #endregion -->',
    ].join('\n');
    const { content, dropped } = dropHidden(md);
    expect(dropped).toBe(3);
    expect(content).toBe(['Last paragraph.', '', '<!-- #region tags=["hermeneutics"] -->', 'Kept.', '<!-- #endregion -->'].join('\n'));
  });

  test('no hidden cells: unchanged', () => {
    const md = '<!-- #region tags=["hermeneutics"] -->\nText with the word hidden.\n<!-- #endregion -->';
    expect(dropHidden(md)).toEqual({ content: md, dropped: 0 });
  });
});
