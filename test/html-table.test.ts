import { describe, expect, test } from 'bun:test';
import {
  decodeEntities,
  outputTableToGfm,
  tableFromHtml,
  tableFromMarkdown,
  tableFromOutputs,
} from '../src/steps/shared/html-table.js';

// Shapes below are trimmed copies of real outputs in the JDH corpus.
const PANDAS = `<div>
<style scoped>
    .dataframe tbody tr th { vertical-align: top; }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>file_name</th>
      <th>mfcc_0</th>
      <th>...</th>
      <th>mfcc_39</th>
    </tr>
  </thead>
  <tbody>
    <tr><th>0</th><td>-1618.mp3</td><td>-160.379290</td><td>...</td><td>-3.463515</td></tr>
    <tr><th>1</th><td>-1624.mp3</td><td>-65.598854</td><td>...</td><td>5.582839</td></tr>
    <tr><th>...</th><td>...</td><td>...</td><td>...</td><td>...</td></tr>
    <tr><th>259</th><td>-2001.mp3</td><td>1.0</td><td>...</td><td>2.0</td></tr>
  </tbody>
</table>
<p>260 rows × 42 columns</p>
</div>`;

const STYLER = `<style  type="text/css" >
</style><table id="T_2b14b_" ><caption>table 1: Some figures &amp; their mentions</caption><thead>    <tr>        <th class="col_heading level0 col0" >HenryVIII</th>        <th class="col_heading level0 col1" >Victoria</th>    </tr></thead><tbody>
                <tr>
                                <td id="T_2b14b_row0_col0" class="data row0 col0" >19</td>
                        <td id="T_2b14b_row0_col1" class="data row0 col1" >20</td>
            </tr>
    </tbody></table>`;

const R_DATA_FRAME = `<table class="dataframe">
<caption>A data.frame: 2 × 2</caption>
<thead>
	<tr><th scope=col>title</th><th scope=col>description</th></tr>
	<tr><th scope=col>&lt;chr&gt;</th><th scope=col>&lt;chr&gt;</th></tr>
</thead>
<tbody>
	<tr><td>Holiday Inn  </td><td>   </td></tr>
	<tr><td>Mae's Cabaret</td><td>(Fri. &amp; Sat. 8pm-3am)
</td></tr>
</tbody>
</table>`;

const NAMED_INDEX = `<table class="dataframe">
  <thead>
    <tr><th></th><th>count</th></tr>
    <tr><th>year</th><th></th></tr>
  </thead>
  <tbody>
    <tr><th>1931</th><td>4</td></tr>
    <tr><th>1932</th><td>7</td></tr>
  </tbody>
</table>`;

describe('tableFromHtml', () => {
  test('pandas: drops the default index, the "..." row and column, reads the footer', () => {
    const t = tableFromHtml(PANDAS)!;
    expect(t.headerRows).toEqual([['file_name', 'mfcc_0', 'mfcc_39']]);
    expect(t.dataRows).toEqual([
      ['-1618.mp3', '-160.379290', '-3.463515'],
      ['-1624.mp3', '-65.598854', '5.582839'],
      ['-2001.mp3', '1.0', '2.0'],
    ]);
    expect(t.totalRows).toBe(260);
    expect(t.caption).toBeNull();
  });

  test('pandas Styler: keeps the caption, decodes entities', () => {
    const t = tableFromHtml(STYLER)!;
    expect(t.headerRows).toEqual([['HenryVIII', 'Victoria']]);
    expect(t.dataRows).toEqual([['19', '20']]);
    expect(t.caption).toBe('table 1: Some figures & their mentions');
    expect(t.totalRows).toBeNull();
  });

  test('R data.frame: drops the column-type row and the "A data.frame" caption', () => {
    const t = tableFromHtml(R_DATA_FRAME)!;
    expect(t.headerRows).toEqual([['title', 'description']]);
    expect(t.dataRows).toEqual([
      ['Holiday Inn', ''],
      ["Mae's Cabaret", '(Fri. & Sat. 8pm-3am)'],
    ]);
    expect(t.caption).toBeNull();
  });

  test('pandas named index: merges the index-name row into the header, keeps the index', () => {
    const t = tableFromHtml(NAMED_INDEX)!;
    expect(t.headerRows).toEqual([['year', 'count']]);
    expect(t.dataRows).toEqual([
      ['1931', '4'],
      ['1932', '7'],
    ]);
  });

  test('table without thead: leading all-th rows are the header', () => {
    const t = tableFromHtml('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>')!;
    expect(t.headerRows).toEqual([['a', 'b']]);
    expect(t.dataRows).toEqual([['1', '2']]);
  });

  test('cell markup is flattened to text', () => {
    const t = tableFromHtml(
      '<table><tr><th>URL</th></tr><tr><td><a href="http://x.org/" target="_blank">http://x.org/</a><br>next</td></tr></table>',
    )!;
    expect(t.dataRows).toEqual([['http://x.org/ next']]);
  });

  test('no table: null', () => {
    expect(tableFromHtml('<div>plot</div>')).toBeNull();
  });
});

describe('tableFromMarkdown', () => {
  test('reads the table and ignores prose around it', () => {
    const md = '\nA data.frame: 2 × 2\n\n| Topic &lt;chr&gt; | Terms |\n|---|---|\n| T1 | a, b |\n| T2 | c \\| d |\n\nafter';
    const t = tableFromMarkdown(md)!;
    expect(t.headerRows).toEqual([['Topic <chr>', 'Terms']]);
    expect(t.dataRows).toEqual([
      ['T1', 'a, b'],
      ['T2', 'c | d'],
    ]);
  });

  test('no table: null', () => {
    expect(tableFromMarkdown('just text')).toBeNull();
  });
});

describe('tableFromOutputs', () => {
  test('prefers an HTML table, also within one output, and falls back to markdown', () => {
    const md = '| m |\n|---|\n| 1 |';
    const both = { text: { 'text/markdown': md, 'text/html': R_DATA_FRAME } };
    expect(tableFromOutputs([both])!.headerRows).toEqual([['title', 'description']]);
    expect(tableFromOutputs([{ text: { 'text/markdown': md } }, { text: { 'text/html': STYLER } }])!.headerRows).toEqual([
      ['HenryVIII', 'Victoria'],
    ]);
    expect(tableFromOutputs([{ text: { 'text/markdown': md, 'text/html': '<div>no table</div>' } }])!.headerRows).toEqual([['m']]);
    expect(tableFromOutputs([{ text: { 'text/plain': 'df' } }])).toBeNull();
  });
});

describe('outputTableToGfm', () => {
  test('escapes markdown punctuation and pads short rows', () => {
    const { markdown, headerRows } = outputTableToGfm({
      headerRows: [['__init__', 'a|b']],
      dataRows: [['*x*']],
      totalRows: null,
      caption: null,
    });
    expect(headerRows).toBe(1);
    expect(markdown).toBe('| \\_\\_init\\_\\_ | a\\|b |\n| --- | --- |\n| \\*x\\* |  |');
  });

  test('extra header rows go first in the body', () => {
    const { markdown, headerRows } = outputTableToGfm({
      headerRows: [['a'], ['b']],
      dataRows: [['1']],
      totalRows: null,
      caption: null,
    });
    expect(headerRows).toBe(2);
    expect(markdown).toBe('| a |\n| --- |\n| b |\n| 1 |');
  });
});

test('decodeEntities', () => {
  expect(decodeEntities('&lt;a&gt; &amp; &#39;q&#x27; &unknown;')).toBe("<a> & 'q' &unknown;");
});
