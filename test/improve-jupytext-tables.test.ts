import { describe, expect, test } from 'bun:test';
import { processArticle } from '../src/steps/jupytext/improve-jupytext-tables.js';
import { processArticle as wrapHermeneutics } from '../src/steps/jupytext/improve-hermeneutics-blocks.js';

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

    expect(content).toContain('```{jdh-table} Example caption.');
    expect(content).toContain(':label: table:1');
    expect(content).not.toContain(':::{table}');
    expect(content).toContain('"source": ["Table 1: Example caption."]');
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

describe('descriptive table tags (JDH-016)', () => {
  const region = (attrs: string, body: string) => `<!-- #region ${attrs} -->\n${body}\n<!-- #endregion -->`;
  const TABLE = '| Step | Activity |\n| --- | --- |\n| 1 | Read |';

  test('a descriptive tag becomes a table:<slug> label, with the caption from the region metadata', () => {
    const md = region('jdh={"module": "object", "object": {"source": ["Teaching sequence 03.10.2025"]}} tags=["table-sequence-*"]', TABLE);
    const { content } = processArticle(md);
    expect(content).toContain('```{jdh-table} Teaching sequence 03.10.2025\n:label: table:sequence\n');
  });

  test('a repeated tag gets a unique label', () => {
    const md = [region('tags=["table-sequence-*"]', TABLE), region('tags=["table-sequence-*"]', TABLE)].join('\n\n');
    const { content } = processArticle(md);
    expect(content).toContain(':label: table:sequence\n');
    expect(content).toContain(':label: table:sequence-2\n');
  });

  test('regions that are not GFM tables, and dialogue tables, are left alone', () => {
    const prose = region('tags=["table-questionnaire-*"]', '**PART I**\n\n1. **Age:**\n\n| Agree | Disagree |\n| --- | --- |\n| [ ] | [ ] |');
    const dialog = region('tags=["table-rich-poor-countries-*", "dialog-rich-poor-countries-*"]', TABLE);
    expect(processArticle(prose).content).toBe(prose);
    expect(processArticle(dialog).content).toBe(dialog);
  });

  test('a hermeneutics table keeps its region, so the hermeneutics block still wraps it', () => {
    const md = region('tags=["hermeneutics", "table-sequence-*"]', TABLE);
    const wrapped = wrapHermeneutics(processArticle(md).content).content;
    expect(wrapped).toStartWith(':::{hermeneutics}');
    expect(wrapped).toContain('```{jdh-table}\n:label: table:sequence');
  });

  test('links to the table\'s anchor-* tag point at its label', () => {
    const md = [
      'Noise in [table 1](#anchor-table-overview) and [the overview](#anchor-table-overview).',
      '',
      region('tags=["table-overview-*", "anchor-table-overview"]', TABLE),
    ].join('\n');
    expect(processArticle(md).content).toContain('Noise in [](#table:overview) and [the overview](#table:overview).');
  });
});
