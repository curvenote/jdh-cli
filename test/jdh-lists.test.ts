import { describe, expect, test } from 'bun:test';
import plugin from '../templates/plugins/jdh-lists.mjs';

// Minimal `selectAll` by node type, enough for these trees.
function selectAll(type: string, node: any): any[] {
  const found: any[] = [];
  const walk = (n: any) => {
    if (n.type === type) found.push(n);
    (n.children ?? []).forEach(walk);
  };
  (node.children ?? []).forEach(walk);
  return found;
}

describe('jdh-lists (JDH-070)', () => {
  test('a line break in a list item stays inline; task items get a box', () => {
    const question = {
      type: 'listItem',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Q?' }, { type: 'break' }, { type: 'text', value: '(note)' }] }],
    };
    const answer = { type: 'listItem', checked: false, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Female' }] }] };
    const tree = { type: 'root', children: [{ type: 'list', ordered: true, children: [question, { type: 'list', children: [answer] }] }] };
    plugin.transforms[0].plugin({}, { selectAll })(tree);
    expect(question.children[0].children[1]).toEqual({ type: 'raw', typst: '#linebreak() ' });
    const first = answer.children[0].children[0] as { type: string; typst: string };
    expect(first.type).toBe('raw');
    expect(first.typst).toStartWith('#box(');
    expect(answer.checked).toBeUndefined();
  });
});
