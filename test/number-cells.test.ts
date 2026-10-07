import { describe, expect, test } from 'bun:test';
import { cellMarker, markCellNumbers, websiteCellNumbers } from '../src/steps/jupytext/number-cells.js';
import type { RawNotebook } from '../src/steps/shared/notebook-cells.js';

const md = (source: string, tags?: string[]) => ({ cell_type: 'markdown', source, metadata: tags ? { tags } : {} });
const code = (source: string, tags?: string[]) => ({ cell_type: 'code', source, metadata: tags ? { tags } : {}, outputs: [] });

describe('websiteCellNumbers (the JDH website rule)', () => {
  test('every cell but metadata takes a number; only markdown cells show it', () => {
    const nb: RawNotebook = {
      cells: [
        md('# Title', ['title']),
        md('Abstract text', ['abstract']),
        md('© Authors', ['copyright']),
        md('First paragraph.'),
        code('x = 1'),
        code('display(Image("a.png"))', ['figure-1-*']),
        md('Hidden', ['hidden']),
        md('Second paragraph.'),
      ],
    };
    expect(websiteCellNumbers(nb)).toEqual([
      { index: 0, num: null, shown: false },
      { index: 1, num: null, shown: false },
      // The copyright cell counts online, but it moves to the front matter.
      { index: 2, num: 1, shown: false },
      { index: 3, num: 2, shown: true },
      { index: 4, num: 3, shown: false },
      { index: 5, num: 4, shown: false },
      { index: 6, num: 5, shown: false },
      { index: 7, num: 6, shown: true },
    ]);
  });

  test('a figure tag wins over a metadata tag, as on the website', () => {
    expect(websiteCellNumbers({ cells: [md('x', ['title', 'figure-1'])] })[0].num).toBe(1);
  });
});

describe('markCellNumbers', () => {
  test('a plain cell gets its marker before its first line; a region cell before the region', () => {
    // From 6EWgjJtoiW6R: one cell holds a paragraph and the research question (one number online).
    const nb: RawNotebook = {
      cells: [
        md('The second part of the analysis.\n\nHow did the sonic style change?'),
        md('> Border research then takes on an applied dimension.', ['hermeneutics']),
      ],
    };
    const article = [
      'The second part of the analysis.',
      '',
      'How did the sonic style change?',
      '',
      '',
      '<!-- #region tags=["hermeneutics"] -->',
      '> Border research then takes on an applied dimension.',
      '<!-- #endregion -->',
    ].join('\n');
    const { content, marked, missing } = markCellNumbers(article, nb);
    expect(marked).toBe(2);
    expect(missing).toEqual([]);
    expect(content).toBe(
      [
        cellMarker(1) + '\n' + 'The second part of the analysis.',
        '',
        'How did the sonic style change?',
        '',
        '',
        cellMarker(2) + '\n' + '<!-- #region tags=["hermeneutics"] -->',
        '> Border research then takes on an applied dimension.',
        '<!-- #endregion -->',
      ].join('\n'),
    );
  });

  test('cells are found by the start of their first line (citations may have been rewritten)', () => {
    const nb: RawNotebook = {
      cells: [md('Let us consider the Swedish case; during the 1970s <cite data-cite="1/A"></cite>.')],
    };
    const { marked } = markCellNumbers('Let us consider the Swedish case; during the 1970s [@a1970].', nb);
    expect(marked).toBe(1);
  });

  test('dialogue and table cells get no marker (their steps need the region to hold only the table)', () => {
    const nb: RawNotebook = {
      cells: [md('| A | B |\n|---|---|\n| hi | |', ['dialog-x-*']), md('| a |\n|---|\n| 1 |', ['table-1'])],
    };
    expect(markCellNumbers('| A | B |\n|---|---|\n| hi | |\n\n| a |\n|---|\n| 1 |', nb).marked).toBe(0);
  });

  test('cells it cannot find are reported', () => {
    expect(markCellNumbers('Something else.', { cells: [md('Not here.')] }).missing).toEqual([0]);
  });
});
