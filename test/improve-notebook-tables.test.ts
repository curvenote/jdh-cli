import { describe, expect, test } from 'bun:test';
import { processArticle } from '../src/steps/jupytext/improve-notebook-tables.js';
import { processArticle as processTableRefs } from '../src/steps/jupytext/improve-jupytext-tables.js';
import { readTaggedCells, tableLabelFromTag, type RawNotebook } from '../src/steps/shared/notebook-cells.js';

const PANDAS_HTML = [
  '<table border="1" class="dataframe">',
  '<thead><tr><th></th><th>year</th><th>count</th></tr></thead>',
  '<tbody><tr><th>0</th><td>1931</td><td>4</td></tr><tr><th>1</th><td>1932</td><td>7</td></tr></tbody>',
  '</table>',
  '<p>90 rows × 2 columns</p>',
].join('\n');

function notebook(cells: { tags: string[]; outputs: unknown[]; jdh?: unknown }[]): RawNotebook {
  return {
    cells: cells.map((c) => ({
      cell_type: 'code',
      source: 'df',
      metadata: { tags: c.tags, ...(c.jdh ? { jdh: c.jdh } : {}) },
      outputs: c.outputs as never,
    })),
  };
}

const html = (data: string, metadata: unknown = {}) => ({
  output_type: 'execute_result',
  data: { 'text/html': data, 'text/plain': 'df' },
  metadata,
});

describe('tableLabelFromTag', () => {
  test.each([
    ['table-1-*', 'table:1'],
    ['table_2', 'table:2'],
    ['table-3', 'table:3'],
    ['table-six-degrees-*', 'table:six-degrees'],
    ['table:4', 'table:4'],
  ])('%s → %s', (tag, label) => expect(tableLabelFromTag(tag)).toBe(label));
});

describe('improve notebook tables', () => {
  test('a pandas output becomes a captioned jdh-table; the code is dropped', () => {
    const article = [
      'Intro.',
      '',
      '```python jdh={"object": {"source": ["Table 1: Letters per year"]}} tags=["table-1", "data-table"]',
      'import pandas as pd',
      'df',
      '```',
      '',
      'After.',
    ].join('\n');
    const cells = readTaggedCells(notebook([{ tags: ['table-1', 'data-table'], outputs: [html(PANDAS_HTML)] }]));

    const { content, report } = processArticle(article, cells);

    expect(report.converted).toEqual(['table:1']);
    expect(content).toBe(
      [
        'Intro.',
        '',
        ':::{jdh-table} Letters per year',
        ':label: table:1',
        ':align: center',
        ':total-rows: 90',
        ':total-columns: 2',
        '',
        '| year | count |',
        '| --- | --- |',
        '| 1931 | 4 |',
        '| 1932 | 7 |',
        ':::',
        '',
        'After.',
      ].join('\n'),
    );
  });

  test('an HTML-exported table with its caption only in the output metadata', () => {
    const article = '```python tags=["table-2"]\ndisplay(HTML(df.to_html()), metadata=metadata)\n```';
    const caption = { jdh: { object: { source: ['table 2: From the output'] } } };
    const cells = readTaggedCells(
      notebook([{ tags: ['table-2'], outputs: [html('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>', caption)] }]),
    );

    const { content } = processArticle(article, cells);

    expect(content).toContain(':::{jdh-table} From the output\n:label: table:2');
    expect(content).not.toContain(':total-rows:');
  });

  test('falls back to the HTML <caption>, then to no caption', () => {
    const styler = '<table><caption>table 3: Styler caption</caption><tr><th>a</th></tr><tr><td>1</td></tr></table>';
    const plain = '<table><tr><th>a</th></tr><tr><td>1</td></tr></table>';
    const article = '```python tags=["table-3"]\ndf\n```\n\n```python tags=["table-4"]\ndf\n```';
    const cells = readTaggedCells(
      notebook([
        { tags: ['table-3'], outputs: [html(styler)] },
        { tags: ['table-4'], outputs: [html(plain)] },
      ]),
    );

    const { content } = processArticle(article, cells);

    expect(content).toContain(':::{jdh-table} Styler caption\n:label: table:3');
    expect(content).toContain(':::{jdh-table}\n:label: table:4');
  });

  test('uses a markdown output when there is no HTML table', () => {
    const article = '```python tags=["table-5"]\ndf\n```';
    const cells = readTaggedCells(
      notebook([
        {
          tags: ['table-5'],
          outputs: [{ output_type: 'execute_result', data: { 'text/markdown': '| m |\n|---|\n| 1 |' }, metadata: {} }],
        },
      ]),
    );

    expect(processArticle(article, cells).content).toContain('| m |\n| --- |\n| 1 |');
  });

  test('cells with no table output stay as code, with a reason', () => {
    const article = '```python tags=["table-6"]\nprint(df)\n```\n\n```python tags=["table-7"]\ndf\n```';
    const cells = readTaggedCells(
      notebook([{ tags: ['table-6'], outputs: [{ output_type: 'stream', name: 'stdout', text: 'x' }] }]),
    );

    const { content, report } = processArticle(article, cells);

    expect(content).toBe(article);
    expect(report.skipped).toEqual([
      { label: 'table:6', reason: 'no notebook output' },
      { label: 'table:7', reason: 'no matching notebook cell' },
    ]);
  });

  test('R cells are converted too', () => {
    const article = '```R jdh={"object": {"source": ["table 1: Topics"]}} tags=["table-1"]\ndf\n```';
    const cells = readTaggedCells(notebook([{ tags: ['table-1'], outputs: [html(PANDAS_HTML)] }]));

    expect(processArticle(article, cells).content).toStartWith(':::{jdh-table} Topics\n:label: table:1');
  });

  test('other code cells are untouched', () => {
    const article = '```python tags=["figure-1-*"]\nplot()\n```\n\n```python\nx = 1\n```';
    expect(processArticle(article, []).content).toBe(article);
  });

  test('references to a converted table become label links', () => {
    const article = 'As Table 1 shows, see [Table 1](#table-1).\n\n```python tags=["table-1"]\ndf\n```';
    const cells = readTaggedCells(notebook([{ tags: ['table-1'], outputs: [html(PANDAS_HTML)] }]));

    const { content } = processTableRefs(processArticle(article, cells).content);

    expect(content).toContain('As [](#table:1) shows, see [](#table:1).');
  });
});
