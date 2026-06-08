import { describe, expect, test } from 'bun:test';
import {
  countHeaderRows,
  parseGfmTable,
  serializeGfmTable,
  truncateColumns,
  truncateRows,
  truncateTable,
} from '../templates/plugins/lib/table-truncate.mjs';

const SAMPLE = [
  '| H1 | H2 | H3 |',
  '| --- | --- | --- |',
  '| a1 | a2 | a3 |',
  '| b1 | b2 | b3 |',
  '| c1 | c2 | c3 |',
  '| d1 | d2 | d3 |',
  '| e1 | e2 | e3 |',
].join('\n');

const MULTI_HEADER = [
  '| Group A | Group B |',
  '| Col1 | Col2 |',
  '| --- | --- |',
  '| x | y |',
  '| p | q |',
  '| r | s |',
].join('\n');

describe('table-truncate', () => {
  test('parseGfmTable splits headers and data', () => {
    const table = parseGfmTable(SAMPLE);
    expect(table.headerRows).toEqual([['H1', 'H2', 'H3']]);
    expect(table.dataRows).toHaveLength(5);
    expect(table.dataRows[0]).toEqual(['a1', 'a2', 'a3']);
  });

  test('truncateRows keeps headers and limits data rows', () => {
    const table = parseGfmTable(SAMPLE);
    const { table: out, hiddenRows } = truncateRows(table, { maxRows: 2 });
    expect(out.headerRows).toHaveLength(1);
    expect(out.dataRows).toHaveLength(2);
    expect(out.dataRows[1]).toEqual(['b1', 'b2', 'b3']);
    expect(hiddenRows).toBe(3);
  });

  test('truncateRows disabled when maxRows is 0', () => {
    const table = parseGfmTable(SAMPLE);
    const { table: out, hiddenRows } = truncateRows(table, { maxRows: 0 });
    expect(out.dataRows).toHaveLength(5);
    expect(hiddenRows).toBe(0);
  });

  test('truncateColumns at boundary (sourceCols === maxColumns + 1) reduces visible count', () => {
    const seven = [
      '| c1 | c2 | c3 | c4 | c5 | c6 | c7 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| d1 | d2 | d3 | d4 | d5 | d6 | d7 |',
    ].join('\n');
    const { table: out, hiddenCols } = truncateColumns(parseGfmTable(seven), {
      maxColumns: 6,
    });
    expect(out.headerRows[0]).toEqual(['c1', 'c2', 'c3', '…', 'c6', 'c7']);
    expect(out.headerRows[0]).toHaveLength(6);
    expect(hiddenCols).toBe(2);
  });

  test('truncateColumns samples start and end with ellipsis', () => {
    const wide = [
      '| c1 | c2 | c3 | c4 | c5 | c6 | c7 | c8 | c9 | c10 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| d1 | d2 | d3 | d4 | d5 | d6 | d7 | d8 | d9 | d10 |',
    ].join('\n');
    const table = parseGfmTable(wide);
    const { table: out, hiddenCols } = truncateColumns(table, { maxColumns: 6 });
    expect(out.headerRows[0]).toEqual(['c1', 'c2', 'c3', '…', 'c9', 'c10']);
    expect(hiddenCols).toBe(5);
  });

  test('truncateTable applies row then column truncation', () => {
    const wide = [
      '| a | b | c | d | e | f | g | h |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |',
      '| 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |',
      '| 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 |',
    ].join('\n');
    const { table: out, hiddenRows, hiddenCols } = truncateTable(parseGfmTable(wide), {
      maxRows: 2,
      maxColumns: 6,
    });
    expect(hiddenRows).toBe(1);
    expect(hiddenCols).toBe(3);
    expect(out.dataRows).toHaveLength(2);
    expect(out.headerRows[0]).toEqual(['a', 'b', 'c', '…', 'g', 'h']);
  });

  test('serializeGfmTable round-trips structure', () => {
    const table = parseGfmTable(SAMPLE);
    const again = parseGfmTable(serializeGfmTable(table));
    expect(again.headerRows).toEqual(table.headerRows);
    expect(again.dataRows).toEqual(table.dataRows);
  });

  test('countHeaderRows counts rows before separator', () => {
    expect(countHeaderRows(SAMPLE)).toBe(1);
    expect(countHeaderRows(MULTI_HEADER)).toBe(2);
  });

  test('countHeaderRows detects pandas group header + column header', () => {
    const pandas = [
      '| Group A | Group B |',
      '| --- | --- |',
      '| Col1 | Col2 |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    expect(countHeaderRows(pandas)).toBe(2);
  });

  test('countHeaderRows does not treat first data row as header', () => {
    const singleHeader = [
      '| Rank | Country |',
      '| --- | --- |',
      '| 1 | France |',
      '| 2 | Germany |',
      '| 3 | Spain |',
    ].join('\n');
    expect(countHeaderRows(singleHeader)).toBe(1);
  });
});
