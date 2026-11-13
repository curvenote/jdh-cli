import { describe, expect, test } from 'bun:test';
import { templateExportOptions } from '../src/commands/build.js';

describe('preprint watermark options (JDH-077)', () => {
  test('a normal build turns the watermark off, so an earlier --preprint is cleared', () => {
    expect([...templateExportOptions('none', false)]).toEqual([
      ['figure_placement', 'none'],
      ['preprint', false],
      ['csl', null],
    ]);
  });

  test('--preprint turns it on with the template default wording', () => {
    const options = templateExportOptions('none', true);
    expect(options.get('preprint')).toBe(true);
    expect(options.has('preprint_text')).toBe(false);
  });

  test('--preprint-text sets the wording', () => {
    expect(templateExportOptions('auto', true, 'ACCEPTED MANUSCRIPT').get('preprint_text')).toBe(
      'ACCEPTED MANUSCRIPT',
    );
  });

  test('--preprint-text without --preprint is an error', () => {
    expect(() => templateExportOptions('none', false, 'ACCEPTED MANUSCRIPT')).toThrow(
      '--preprint-text only applies with --preprint.',
    );
  });

  test('an unknown figure placement is still rejected', () => {
    expect(() => templateExportOptions('sideways', false)).toThrow('--figure-placement');
  });
});

describe('citation style (JDH-078)', () => {
  test('no --csl removes the option, so the build falls back to the built-in APA', () => {
    expect(templateExportOptions('none', false).get('csl')).toBeNull();
  });

  test('--csl passes the file through to the template', () => {
    expect(templateExportOptions('none', false, undefined, '/styles/apa.csl').get('csl')).toBe(
      '/styles/apa.csl',
    );
  });
});
