import { describe, expect, test } from 'bun:test';
import plugin from '../templates/plugins/hermeneutics.mjs';

interface Node {
  type: string;
  kind?: string;
  typst?: string;
  children?: Node[];
}

const run = (tree: Node) => {
  plugin.transforms[0].plugin()(tree);
  return tree;
};
/** The typst wrappers the transform adds around a block, as a pair of booleans. */
const wrappers = (node: Node) => ({
  opens: node.children[0]?.typst === '#hermeneutics-block[\n',
  closes: node.children[node.children.length - 1]?.typst === '\n]',
});
const prose = () => ({
  type: 'block',
  kind: 'hermeneutics',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'commentary' }] }],
});
const withCode = () => ({
  type: 'block',
  kind: 'hermeneutics',
  children: [{ type: 'code', lang: 'python', value: 'import pandas' }],
});
const cellMarker = () => ({ type: 'raw', typst: '#jdh-cell(9)' });

describe('hermeneutics blocks', () => {
  test('one cell opens and closes its own block', () => {
    const tree = run({ type: 'root', children: [prose()] });
    expect(wrappers(tree.children[0])).toEqual({ opens: true, closes: true });
  });

  test('consecutive prose cells share one block (JDH-061)', () => {
    const tree = run({ type: 'root', children: [prose(), cellMarker(), prose(), cellMarker(), prose()] });
    const blocks = tree.children.filter((n: Node) => n.kind === 'hermeneutics');
    expect(blocks.map(wrappers)).toEqual([
      { opens: true, closes: false },
      { opens: false, closes: false },
      { opens: false, closes: true },
    ]);
  });

  test('a cell holding code keeps a block of its own (JDH-074)', () => {
    const tree = run({ type: 'root', children: [withCode(), cellMarker(), withCode()] });
    const blocks = tree.children.filter((n: Node) => n.kind === 'hermeneutics');
    expect(blocks.map(wrappers)).toEqual([
      { opens: true, closes: true },
      { opens: true, closes: true },
    ]);
  });

  test('a code cell does not join the prose cell before it (JDH-074)', () => {
    const tree = run({ type: 'root', children: [prose(), cellMarker(), withCode()] });
    const blocks = tree.children.filter((n: Node) => n.kind === 'hermeneutics');
    expect(blocks.map(wrappers)).toEqual([
      { opens: true, closes: true },
      { opens: true, closes: true },
    ]);
  });

  test('code nested deeper in a cell still breaks the run (JDH-074)', () => {
    const nested = {
      type: 'block',
      kind: 'hermeneutics',
      children: [{ type: 'container', children: [{ type: 'code', lang: 'python', value: 'x = 1' }] }],
    };
    const tree = run({ type: 'root', children: [prose(), cellMarker(), nested] });
    const blocks = tree.children.filter((n: Node) => n.kind === 'hermeneutics');
    expect(blocks.map(wrappers)).toEqual([
      { opens: true, closes: true },
      { opens: true, closes: true },
    ]);
  });

  test('prose cells either side of a code cell do not join across it', () => {
    const tree = run({
      type: 'root',
      children: [prose(), cellMarker(), withCode(), cellMarker(), prose()],
    });
    const blocks = tree.children.filter((n: Node) => n.kind === 'hermeneutics');
    expect(blocks.map(wrappers)).toEqual([
      { opens: true, closes: true },
      { opens: true, closes: true },
      { opens: true, closes: true },
    ]);
  });

  test('content between two cells keeps them apart', () => {
    const tree = run({
      type: 'root',
      children: [prose(), { type: 'paragraph', children: [{ type: 'text', value: 'main text' }] }, prose()],
    });
    const blocks = tree.children.filter((n: Node) => n.kind === 'hermeneutics');
    expect(blocks.map(wrappers)).toEqual([
      { opens: true, closes: true },
      { opens: true, closes: true },
    ]);
  });
});
