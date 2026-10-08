import { describe, expect, test } from 'bun:test';
import {
  figureLabelFromTag,
  kindFromTags,
  parseFenceMetadata,
  readTaggedCells,
  resolveCaption,
  selectOutputs,
  audioLabelFromTag,
  hasAudioOutput,
} from '../src/steps/shared/notebook-cells.js';
import { captionFromJdh } from '../src/steps/shared/notebook-cells.js';

describe('kindFromTags', () => {
  test('recognises numbered and descriptive tags of each kind', () => {
    expect(kindFromTags(['hermeneutics', 'figure-1-*'])).toEqual({ kind: 'figure', tag: 'figure-1-*' });
    expect(kindFromTags(['figure-pie-chart-citizen-scientists-country-*'])?.kind).toBe('figure');
    expect(kindFromTags(['fig:2'])?.kind).toBe('figure');
    expect(kindFromTags(['table-2', 'data-table'])).toEqual({ kind: 'table', tag: 'table-2' });
    expect(kindFromTags(['sound-franklin-*'])?.kind).toBe('sound');
    expect(kindFromTags(['video-interview-*'])?.kind).toBe('video');
  });

  test('ignores tags that only start with a kind word', () => {
    expect(kindFromTags(['hermeneutics', 'narrative', 'w-904px'])).toBeNull();
    expect(kindFromTags(['figures-appendix'])).toBeNull();
  });

  test("follows the website's rule: the tag must start with figure-, table-, sound-, video- (JDH-047)", () => {
    // 6EWgjJtoiW6R cell 59: Figure 11 in the PDF, not a figure online.
    expect(kindFromTags(['figure_sound_types*'])).toBeNull();
    expect(kindFromTags(['anchor-figure-1-*'])).toBeNull();
    expect(kindFromTags(['audio-1'])).toBeNull();
    expect(kindFromTags(['data-table-1'])?.kind).toBe('table');
  });
});

describe('figureLabelFromTag', () => {
  test('maps every figure tag form to a fig: label', () => {
    expect(figureLabelFromTag('figure-1-*')).toBe('fig:1');
    expect(figureLabelFromTag('figure_1')).toBe('fig:1');
    expect(figureLabelFromTag('fig:3')).toBe('fig:3');
    expect(figureLabelFromTag('figure-cartoon-*')).toBe('fig:cartoon');
    expect(figureLabelFromTag('figure-average-no-comments-per-post-*')).toBe(
      'fig:average-no-comments-per-post',
    );
  });
});

describe('parseFenceMetadata', () => {
  test('reads Jupytext cell metadata from a fence line', () => {
    const line =
      'python jdh={"module": "object", "object": {"source": ["A {braced} caption"]}} tags=["figure-cartoon-*"]';
    expect(parseFenceMetadata(line, 'jdh')).toEqual({
      module: 'object',
      object: { source: ['A {braced} caption'] },
    });
    expect(parseFenceMetadata('python tags=["x"]', 'jdh')).toBeNull();
  });
});

describe('resolveCaption', () => {
  test('prefers the code literal and flags stale output captions', () => {
    // BHmHNQKJaSWT figure 3: copy-edited code vs. output metadata from an older run.
    const r = resolveCaption({
      code: 'Figure 3. Average cosine similarity of the one hundred nearest neighbours.',
      cell: null,
      output: 'Figure 3. Average cosine similarity of the one hundred nearest neighbors.',
    });
    expect(r.from).toBe('code');
    expect(r.text).toContain('neighbours');
    expect(r.conflict).toBe(true);
  });

  test('falls back to cell metadata, then output metadata', () => {
    expect(resolveCaption({ code: null, cell: 'Cell caption', output: 'Out' }).from).toBe('cell');
    expect(resolveCaption({ code: null, cell: null, output: 'Out' }).from).toBe('output');
    expect(resolveCaption({ code: null, cell: null, output: null }).text).toBeNull();
  });

  test('ignores differences in the "Figure N." prefix and whitespace', () => {
    const r = resolveCaption({ code: 'Figure 1. A  chart.', cell: null, output: 'A chart.' });
    expect(r.conflict).toBe(false);
  });
});

describe('selectOutputs', () => {
  test('drops stream and error outputs and picks the preferred MIME type', () => {
    const { outputs, dropped } = selectOutputs([
      { output_type: 'stream', data: undefined },
      { output_type: 'display_data', data: { 'text/plain': ['<Image>'], 'image/png': 'iVBOR' } },
      { output_type: 'execute_result', data: { 'text/plain': 'df', 'text/html': ['<table>', '</table>'] } },
      { output_type: 'error' },
    ]);
    expect(dropped).toBe(2);
    expect(outputs.map((o) => o.mime)).toEqual(['image/png', 'text/html']);
    expect(outputs[1].data).toBe('<table></table>');
    expect(outputs[1].text).toEqual({ 'text/plain': 'df', 'text/html': '<table></table>' });
  });
});

describe('readTaggedCells', () => {
  test('collects kind, captions from all three places, and outputs', () => {
    const cells = readTaggedCells({
      cells: [
        { cell_type: 'markdown', metadata: { tags: ['figure-9-*'] }, source: 'not code' },
        {
          cell_type: 'code',
          metadata: { tags: ['figure-pie-*'], jdh: { object: { source: ['Pie ', 'chart'] } } },
          source: ['fig'],
          outputs: [
            {
              output_type: 'display_data',
              data: { 'text/html': '<div class="plotly-graph-div"></div>' },
              metadata: { jdh: { object: { source: ['Pie chart (old)'] } } },
            },
            { output_type: 'stream' },
          ],
        },
        { cell_type: 'code', metadata: { tags: ['hermeneutics'] }, source: 'print(1)', outputs: [] },
      ],
    });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      index: 1,
      kind: 'figure',
      tag: 'figure-pie-*',
      captions: { code: null, cell: 'Pie chart', output: 'Pie chart (old)' },
      dropped: 1,
    });
    expect(cells[0].outputs[0].mime).toBe('text/html');
  });
});

describe('captionFromJdh', () => {
  test('joins caption pieces with a space when they lack one', () => {
    // 7XSDVCtnbXva: a URL piece followed by "(Copyright …)" must not run together.
    expect(captionFromJdh({ object: { source: ['UNData (2016), https://data.un.org/x?a=1&b=2', '(Copyright UNData.)'] } })).toBe(
      'UNData (2016), https://data.un.org/x?a=1&b=2 (Copyright UNData.)',
    );
    expect(captionFromJdh({ object: { source: ['Line one\n', 'line two'] } })).toBe('Line one\nline two');
  });
});

describe('audio helpers', () => {
  test('audioLabelFromTag', () => {
    expect(audioLabelFromTag('sound-franklin-*')).toBe('aud:franklin');
    expect(audioLabelFromTag('sound-conversation-length-*')).toBe('aud:conversation-length');
    expect(audioLabelFromTag('audio_2')).toBe('aud:2');
  });

  test('hasAudioOutput', () => {
    const out = (mime: string, html?: string) => ({ mime, data: '', text: html ? { 'text/html': html } : {}, metadata: {} });
    expect(hasAudioOutput({ outputs: [out('text/html', '<audio controls></audio>')] })).toBe(true);
    expect(hasAudioOutput({ outputs: [out('audio/mpeg')] })).toBe(true);
    expect(hasAudioOutput({ outputs: [out('image/png'), out('text/html', '<div></div>')] })).toBe(false);
    expect(hasAudioOutput(undefined)).toBe(false);
  });
});
