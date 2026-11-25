import { describe, expect, test } from 'bun:test';
import narrativeCode from '../templates/plugins/narrative-code.mjs';
import { MARKDOWN_CODE_CLASS } from '../src/steps/jupytext/mark-markdown-code.js';

/** Just enough of an mdast node for these trees. */
type TestNode = {
  type: string;
  class?: string;
  kind?: string;
  typst?: string;
  lang?: string;
  value?: string;
  data?: Record<string, unknown>;
  children?: TestNode[];
};

const code = (extra: Partial<TestNode> = {}): TestNode => ({
  type: 'code',
  lang: 'yaml',
  value: 'id: 2',
  ...extra,
});
const marked = (extra: Partial<TestNode> = {}) => code({ class: MARKDOWN_CODE_CLASS, ...extra });
const root = (...children: TestNode[]): TestNode => ({ type: 'root', children });

/** narrative-code needs a `selectAll`; this one understands `block[kind=hermeneutics] code`. */
function run(tree: TestNode) {
  const selectAll = (sel: string, node: TestNode): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode, inHerm: boolean) => {
      const herm = inHerm || (n.type === 'block' && n.kind === 'hermeneutics');
      if (sel === 'block' && n.type === 'block') out.push(n);
      if (sel === 'code' && n.type === 'code') out.push(n);
      if (sel === 'block[kind=hermeneutics] code' && n.type === 'code' && herm) out.push(n);
      (n.children ?? []).forEach((c) => walk(c, herm));
    };
    walk(node, false);
    return out;
  };
  narrativeCode.transforms[0].plugin({}, { selectAll })(tree);
  return tree;
}

const wrappers = (tree: TestNode) =>
  (tree.children ?? []).filter((c) => c.type === 'raw').map((c) => c.typst);

/**
 * JDH-100's rendering half. Mirjam's spec table:
 *
 *   executable code, any layer      → grey slab
 *   markdown code in hermeneutics   → the teal band shows through
 *   markdown code in narrative      → white
 *
 * Hermeneutics was already right: narrative-code has always skipped code inside a
 * hermeneutics block. The narrative case is the one that needed changing, and it needs
 * only a skip — an unwrapped code node already renders white with its syntax colours, so
 * leaving it alone *is* the fix. No Typst wrapper is involved.
 */
describe('markdown code is not given the narrative grey slab (JDH-100)', () => {
  test('a marked block in the narrative layer is left unwrapped', () => {
    const tree = root(marked());
    run(tree);
    expect(wrappers(tree)).toEqual([]);
    expect(tree.children).toHaveLength(1);
  });

  test('an ordinary narrative code block still gets the slab', () => {
    const tree = root(code());
    run(tree);
    expect(wrappers(tree)).toEqual(['#narrative-code-block[\n', '\n]']);
  });

  test('marked and unmarked side by side: only the unmarked one is wrapped', () => {
    const tree = root(marked(), code());
    run(tree);
    expect(wrappers(tree)).toEqual(['#narrative-code-block[\n', '\n]']);
    const i = (tree.children ?? []).findIndex((c) => c.typst === '#narrative-code-block[\n');
    expect(tree.children?.[i + 1].class).toBeUndefined();
  });

  test('the class may arrive alongside others, and a near-miss is not a match', () => {
    const both = root(code({ class: `wide ${MARKDOWN_CODE_CLASS}` }));
    run(both);
    expect(wrappers(both)).toEqual([]);

    const near = root(code({ class: `${MARKDOWN_CODE_CLASS}-x` }));
    run(near);
    expect(wrappers(near)).toEqual(['#narrative-code-block[\n', '\n]']);
  });

  test('inside hermeneutics nothing is wrapped either way — the band shows through', () => {
    const tree = root({
      type: 'block',
      kind: 'hermeneutics',
      children: [marked(), code()],
    });
    run(tree);
    const inner = tree.children?.[0].children ?? [];
    expect(inner.filter((c) => c.type === 'raw')).toHaveLength(0);
    expect(inner).toHaveLength(2);
  });
});
