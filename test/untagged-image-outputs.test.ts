import { describe, expect, test } from 'bun:test';
import { coverCells, imageBlock, placeUntaggedImages, untaggedImageOutputs } from '../src/steps/jupytext/improve-untagged-image-outputs.js';
import type { RawNotebook } from '../src/steps/shared/notebook-cells.js';

// 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const codeCell = (source: string, tags: string[] = [], png = true) => ({
  cell_type: 'code',
  source,
  metadata: { tags },
  outputs: png ? [{ output_type: 'display_data', data: { 'image/png': PNG, 'text/plain': '<Figure>' } }] : [],
});

describe('untaggedImageOutputs (JDH-046)', () => {
  test('untagged code cells with an image; figures, hidden cells and the cover are left out', () => {
    const nb: RawNotebook = {
      cells: [
        codeCell('plot_result(a)', ['hermeneutics']),
        codeCell('display(Image("x.png"))', ['figure-1-*']),
        codeCell('setup()', ['hidden']),
        codeCell('display(Image("cover.jpg"))', ['cover']),
        codeCell('print(1)', [], false),
        // 6EWgjJtoiW6R cell 59: not a figure on the website, so an untagged image.
        codeCell('display(Image("sound_types.png"))', ['figure_sound_types*']),
      ],
    };
    expect(untaggedImageOutputs(nb).map((i) => [i.index, i.ext])).toEqual([
      [0, 'png'],
      [5, 'png'],
    ]);
  });
});

describe('placeUntaggedImages', () => {
  test("the image goes after its own cell's fence, matched on the whole code", () => {
    const md = [
      '```python',
      'from IPython.display import Image',
      'display(Image("a.png"))',
      '```',
      '',
      '```python tags=["hermeneutics"]',
      'from IPython.display import Image',
      'plot_result(a)',
      '```',
    ].join('\n');
    const { content, placed } = placeUntaggedImages(md, [
      { index: 7, code: 'from IPython.display import Image\nplot_result(a)', rel: 'notebook-outputs/cell-7.png' },
    ]);
    expect(placed).toEqual([7]);
    expect(content).toBe(md + '\n' + imageBlock('notebook-outputs/cell-7.png'));
  });

  test('a cell whose code is not in article.md is reported', () => {
    expect(placeUntaggedImages('```python\nx = 1\n```', [{ index: 3, code: 'y = 2', rel: 'r.png' }]).missing).toEqual([3]);
  });
});

describe('cover (JDH-055)', () => {
  test('a cover cell gives the file its code displays and its stored image', () => {
    const nb: RawNotebook = {
      cells: [
        codeCell('from IPython.display import Image, display\n\ndisplay(Image("./media/cover.png"))', ['cover']),
        codeCell('display(Image("x.png"))', []),
        codeCell('make_cover()', ['cover'], false),
      ],
    };
    expect(coverCells(nb).map((c) => [c.index, c.imagePath, c.output?.ext ?? null])).toEqual([
      [0, './media/cover.png', 'png'],
      [2, null, null],
    ]);
  });

  test('the cover image replaces its code; other images go after theirs', () => {
    const md = [
      '# Title',
      '',
      '```python tags=["cover"]',
      'display(Image("media/cover.jpg"))',
      '```',
      '',
      '```python',
      'plot(a)',
      '```',
    ].join('\n');
    const { content, placed } = placeUntaggedImages(md, [
      { index: 5, code: 'plot(a)', rel: 'notebook-outputs/cell-5.png' },
      { index: 3, code: 'display(Image("media/cover.jpg"))', rel: 'media/cover.jpg', replace: true },
    ]);
    expect(placed).toEqual([3, 5]);
    expect(content).not.toContain('display(Image("media/cover.jpg"))');
    expect(content).toBe(
      ['# Title', '', imageBlock('media/cover.jpg'), '', '```python', 'plot(a)', '```', imageBlock('notebook-outputs/cell-5.png')].join('\n'),
    );
  });
});
