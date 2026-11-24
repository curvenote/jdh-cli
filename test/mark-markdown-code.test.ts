import { describe, expect, test } from 'bun:test';
import { markMarkdownCode, MARKDOWN_CODE_CLASS } from '../src/steps/jupytext/mark-markdown-code.js';

describe('mark-markdown-code (JDH-100)', () => {
  test('a fence inside a markdown cell is marked, whatever its language', () => {
    const md = [
      '<!-- #region tags=["hermeneutics"] -->',
      '```yaml',
      'prompt: |',
      '  Extract text',
      '```',
      '<!-- #endregion -->',
    ].join('\n');
    const { content, marked } = markMarkdownCode(md);
    expect(marked).toBe(1);
    expect(content).toInclude('```{code-block} yaml');
    expect(content).toInclude(`:class: ${MARKDOWN_CODE_CLASS}`);
    // The body is untouched.
    expect(content).toInclude('  Extract text');
  });

  test('java, a bare fence and yaml are all treated the same', () => {
    const cell = (fence: string) =>
      ['<!-- #region -->', fence, 'int i = 0;', '```', '<!-- #endregion -->'].join('\n');
    for (const [fence, lang] of [
      ['```java', 'java'],
      ['```yaml', 'yaml'],
      ['```', 'text'],
    ] as const) {
      const { content, marked } = markMarkdownCode(cell(fence));
      expect(marked).toBe(1);
      expect(content).toInclude(`\`\`\`{code-block} ${lang}`);
    }
  });

  test('a top-level fence is a notebook code cell and is left alone', () => {
    // This is the case that defeats classifying on the fence text: a code cell
    // written with no metadata looks exactly like a markdown fence (BHmHNQKJaSWT
    // does this 11 times).
    const md = ['```python', 'import pandas', '```'].join('\n');
    const { content, marked } = markMarkdownCode(md);
    expect(marked).toBe(0);
    expect(content).toBe(md);
  });

  test('a code cell with jupytext metadata is also left alone', () => {
    const md = ['```python editable=true tags=["hermeneutics"]', 'import os', '```'].join('\n');
    expect(markMarkdownCode(md).marked).toBe(0);
  });

  test('a directive inside a markdown cell is not a plain fence', () => {
    const md = [
      '<!-- #region -->',
      '```{figure} ./media/x.png',
      ':label: fig:1',
      '```',
      '<!-- #endregion -->',
    ].join('\n');
    expect(markMarkdownCode(md).marked).toBe(0);
  });

  test('fence content is never scanned for further fences', () => {
    const md = [
      '<!-- #region -->',
      '````markdown',
      'Here is how you write one:',
      '```python',
      'x = 1',
      '```',
      '````',
      '<!-- #endregion -->',
    ].join('\n');
    const { marked } = markMarkdownCode(md);
    expect(marked).toBe(1);
  });

  test('an unclosed fence leaves the cell untouched', () => {
    const md = ['<!-- #region -->', '```yaml', 'prompt: |', '<!-- #endregion -->'].join('\n');
    const { content, marked } = markMarkdownCode(md);
    expect(marked).toBe(0);
    expect(content).toBe(md);
  });

  test('several cells, mixed', () => {
    const md = [
      '```python',
      'real_code()',
      '```',
      '',
      '<!-- #region tags=["hermeneutics"] -->',
      'Some prose.',
      '',
      '```yaml',
      'id: 2',
      '```',
      '<!-- #endregion -->',
      '',
      '```r editable=true',
      'plot(x)',
      '```',
    ].join('\n');
    const { content, marked } = markMarkdownCode(md);
    expect(marked).toBe(1);
    expect(content).toInclude('```python\nreal_code()');
    expect(content).toInclude('```r editable=true\nplot(x)');
    expect(content).toInclude('```{code-block} yaml');
  });
});
