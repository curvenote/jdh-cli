import { describe, expect, test } from 'bun:test';
import { processArticle } from '../src/steps/jupytext/improve-notebook-figures.js';

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
      'See the source at [](#code:fig:1).',
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
  });
});
