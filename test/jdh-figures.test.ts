import { describe, expect, test } from 'bun:test';
import plugin from '../templates/plugins/jdh-figures.mjs';

const run = (tree: any) => {
  plugin.transforms[0].plugin()(tree);
  return tree;
};
const figure = (image: Record<string, unknown>) => ({
  type: 'container',
  kind: 'figure',
  children: [{ type: 'image', url: 'a.png', ...image }, { type: 'caption', children: [] }],
});

describe('jdh-figures', () => {
  test('a figure image with no width gets the full text width', () => {
    const tree = run({ type: 'root', children: [figure({})] });
    expect(tree.children[0].children[0].width).toBe('100%');
  });

  test('a width the author set is kept', () => {
    const tree = run({ type: 'root', children: [figure({ width: '40%' })] });
    expect(tree.children[0].children[0].width).toBe('40%');
  });

  test('images outside figures are left alone', () => {
    const tree = run({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'image', url: 'icon.png' }] }] });
    expect(tree.children[0].children[0].width).toBeUndefined();
  });
});
