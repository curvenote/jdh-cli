import { describe, expect, test } from 'bun:test';
import { processArticle as dropHidden } from '../src/steps/jupytext/drop-hidden-cells.js';
import { anchorLabel, processArticle as linkAnchors } from '../src/steps/jupytext/improve-jupytext-anchors.js';
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

describe('improveJupytextAnchors', () => {
  test('anchorLabel drops the trailing wildcard', () => {
    expect(anchorLabel('anchor-section-2-*')).toBe('anchor-section-2');
    expect(anchorLabel('anchor-getting-the-data')).toBe('anchor-getting-the-data');
  });

  test('headings and paragraphs get a target inside their region', () => {
    // From 7XSDVCtnbXva.
    const md = [
      '<!-- #region tags=["hermeneutics", "anchor-getting-the-data"] -->',
      '## Getting the data',
      '<!-- #endregion -->',
      '',
      'As described in ([Getting the data](#anchor-getting-the-data)).',
    ].join('\n');
    expect(linkAnchors(md).content).toBe(
      [
        '<!-- #region tags=["hermeneutics", "anchor-getting-the-data"] -->',
        '(anchor-getting-the-data)=',
        '## Getting the data',
        '<!-- #endregion -->',
        '',
        'As described in ([Getting the data](#anchor-getting-the-data)).',
      ].join('\n'),
    );
  });

  test('wildcard anchors: target and links use the clean label', () => {
    const md = ['<!-- #region tags=["anchor-section-2-*"] -->', '## Two', '<!-- #endregion -->', '', 'See [section 2](#anchor-section-2-*).'].join('\n');
    const { content } = linkAnchors(md);
    expect(content).toContain('(anchor-section-2)=\n## Two');
    expect(content).toContain('See [section 2](#anchor-section-2).');
  });

  test('code cells get a target in front of the fence', () => {
    const md = ['```python tags=["anchor-code"]', 'x = 1', '```', '', '[the code](#anchor-code)'].join('\n');
    expect(linkAnchors(md).content).toBe(['(anchor-code)=', '```python tags=["anchor-code"]', 'x = 1', '```', '', '[the code](#anchor-code)'].join('\n'));
  });

  test('figure cells are linked through their figure label, with no extra target', () => {
    // From 52s3BFHa5Miy: one figure, two links to its halves.
    const md = [
      '```python tags=["figure-4-*", "anchor-figure-4-*"]',
      'display(Image("media/fig4.png"))',
      '```',
      '',
      'Explorer ([Figure 4: Left](#anchor-figure-4-*)) and ([Figure 4: Right](#anchor-figure-4-*)).',
    ].join('\n');
    const { content } = linkAnchors(md);
    expect(content).not.toContain(')=');
    expect(content).toContain('([Figure 4: Left](#fig:4)) and ([Figure 4: Right](#fig:4))');
  });

  test('table cells are left to the table step', () => {
    const md = ['<!-- #region tags=["table-1-*", "anchor-table-1"] -->', '| a |', '|---|', '| 1 |', '<!-- #endregion -->', '', '[table 1](#anchor-table-1)'].join('\n');
    expect(linkAnchors(md)).toEqual({ content: md, anchors: [] });
  });

  test('links to an anchor no cell carries are left as they are', () => {
    const md = 'See [there](#anchor-nowhere).';
    expect(linkAnchors(md).content).toBe(md);
  });
});
