import { describe, expect, test } from 'bun:test';
import { processArticle } from '../src/steps/jupytext/improve-notebook-figures.js';
import { readTaggedCells } from '../src/steps/shared/notebook-cells.js';

describe('improve notebook figures', () => {
  test('emits figure directive only (no code-block) for figure-tagged cells', () => {
    const input = [
      'See [Figure 1](#figure-1-*).',
      '',
      '```python tags=["figure-1-*", "figure_1"]',
      'from IPython.display import Image, display',
      'metadata={"jdh":{"module":"object","object":{"type":"image","source":["Figure 1. A chart."]}}}',
      'display(Image("./media/figure1.png", width=1000), metadata=metadata)',
      '```',
    ].join('\n');

    const { content } = processArticle(input);

    expect(content).toContain('```{figure} ./media/figure1.png');
    expect(content).toContain(':label: fig:1');
    expect(content).not.toContain('{code-block}');
    expect(content).not.toContain('code:fig:');
    expect(content).not.toContain('display(Image');
    expect(content).toContain('[](#fig:1)');
  });

  test('rewrites legacy code:fig cross-references to fig:N', () => {
    const input = [
      'See the source at [](#code:fig:1) and {ref}`code:fig:1`.',
      '',
      '```python tags=["figure-1-*"]',
      'from IPython.display import Image, display',
      'metadata={"jdh":{"module":"object","object":{"type":"image","source":["Figure 1. A chart."]}}}',
      'display(Image("./media/figure1.png", width=1000), metadata=metadata)',
      '```',
    ].join('\n');

    const { content } = processArticle(input);

    expect(content).toContain('[](#fig:1)');
    expect(content).not.toContain('code:fig:');
    expect(content).not.toMatch(/\{ref\}`code:fig:1`/);
  });

  test('leaves no stray closing fence after a converted figure', () => {
    const input = [
      '```python tags=["figure-1-*"]',
      'metadata={"jdh":{"object":{"source":["Figure 1. A chart."]}}}',
      'display(Image("./media/figure1.png"), metadata=metadata)',
      '```',
      '',
      'Next paragraph.',
    ].join('\n');

    const { content } = processArticle(input);

    expect(content).not.toContain('``````');
    expect(content).toBe(
      ['```{figure} ./media/figure1.png', ':label: fig:1', '', 'A chart.', '```', '', 'Next paragraph.'].join('\n'),
    );
  });

  test('converts descriptive tags with the caption from the fence-line cell metadata', () => {
    // Chronoferencing (6ig87tC5GKjQ) pattern: descriptive tag, caption only in cell metadata.
    const input = [
      'As shown in [this figure](#figure-cartoon-*) and {ref}`figure-cartoon-*`.',
      '',
      '```python jdh={"module": "object", "object": {"source": ["A cartoon by citizen scientists"]}} tags=["hermeneutics", "figure-cartoon-*"]',
      'display(Image("media/cartoon.png"))',
      '```',
    ].join('\n');

    const { content, report } = processArticle(input);

    expect(content).toContain('```{figure} media/cartoon.png\n:label: fig:cartoon\n\nA cartoon by citizen scientists\n```');
    expect(content).toContain('[this figure](#fig:cartoon)');
    expect(content).toContain('and [](#fig:cartoon).');
    expect(report.converted).toEqual(['fig:cartoon']);
  });

  test('prefers the code caption and reports a stale notebook caption', () => {
    const input = [
      '```python tags=["figure-3-*"]',
      'metadata={"jdh":{"object":{"source":["Figure 3. Nearest neighbours."]}}}',
      'display(Image("./media/figure3.png"), metadata=metadata)',
      '```',
    ].join('\n');
    const notebookCells = readTaggedCells({
      cells: [
        {
          cell_type: 'code',
          metadata: { tags: ['figure-3-*'] },
          source: '',
          outputs: [
            {
              output_type: 'display_data',
              data: { 'image/png': 'iVBOR' },
              metadata: { jdh: { object: { source: ['Figure 3. Nearest neighbors.'] } } },
            },
          ],
        },
      ],
    });

    const { content, report } = processArticle(input, notebookCells);

    expect(content).toContain('Nearest neighbours.');
    expect(report.captionConflicts).toEqual([{ label: 'fig:3', used: 'code', others: ['output'] }]);
  });

  test('takes the caption from notebook output metadata when it is the only source', () => {
    const input = ['```python tags=["figure-map-*"]', 'display(Image("media/map.png"))', '```'].join('\n');
    const notebookCells = readTaggedCells({
      cells: [
        {
          cell_type: 'code',
          metadata: { tags: ['figure-map-*'] },
          source: '',
          outputs: [
            {
              output_type: 'display_data',
              data: { 'image/png': 'iVBOR' },
              metadata: { jdh: { object: { source: ['A map.'] } } },
            },
          ],
        },
      ],
    });

    const { content } = processArticle(input, notebookCells);

    expect(content).toContain(':label: fig:map\n\nA map.');
  });

  test('reports computed figures with their notebook output types and leaves them as code', () => {
    const input = [
      '```python jdh={"object": {"source": ["Pie chart"]}} tags=["figure-pie-*"]',
      'fig = go.Figure()',
      'fig',
      '```',
    ].join('\n');
    const notebookCells = readTaggedCells({
      cells: [
        {
          cell_type: 'code',
          metadata: { tags: ['figure-pie-*'] },
          source: 'fig',
          outputs: [{ output_type: 'display_data', data: { 'text/html': '<div></div>' } }],
        },
      ],
    });

    const { content, report } = processArticle(input, notebookCells);

    expect(content).toContain('fig = go.Figure()');
    expect(report.skipped).toEqual([
      { label: 'fig:pie', reason: 'no image file in code; notebook output text/html' },
    ]);
  });

  test('leaves a figure as code when its image file is missing', () => {
    const input = [
      '```python tags=["figure-1-*"]',
      'metadata={"jdh":{"object":{"source":["Figure 1. A chart."]}}}',
      'display(Image(filename="waveform.png"))',
      '```',
    ].join('\n');

    const { content, report } = processArticle(input, [], () => false);

    expect(content).not.toContain('{figure}');
    expect(report.skipped).toEqual([{ label: 'fig:1', reason: 'image file waveform.png not found' }]);
  });
});
