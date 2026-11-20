import { describe, expect, test } from 'bun:test';
import plugin from '../templates/plugins/fix-link-escapes.mjs';

function run(tree: any) {
  plugin.transforms[0].plugin({}, {})(tree);
  return tree;
}

const link = (url: string, children: any[]) => ({ type: 'link', url, children });
const text = (value: string) => ({ type: 'text', value });

describe('fix-link-escapes (JDH-094)', () => {
  test('a URL with "&" becomes raw Typst, with the ampersand unescaped', () => {
    const url = 'https://data.un.org/Data.aspx?q=internet&d=ITU&f=ind1Code%3AI99H';
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [link(url, [text(url)])] }] };
    run(tree);
    const node = tree.children[0].children[0] as { type: string; typst: string };
    expect(node.type).toBe('raw');
    expect(node.typst).toBe(`#link("${url}", "${url}")`);
    // The two faults this ticket is about: no backslash anywhere, and one link only.
    expect(node.typst).not.toInclude('\\&');
    expect(node.typst.match(/#link\(/g)).toHaveLength(1);
  });

  test('link text that differs from the URL is kept', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'paragraph', children: [link('https://ex.com/a?x=1&y=2', [text('UNData')])] }],
    };
    run(tree);
    expect((tree.children[0].children[0] as any).typst).toBe('#link("https://ex.com/a?x=1&y=2", "UNData")');
  });

  test('a URL without "&" is left for MyST', () => {
    const node = link('https://ex.com/plain', [text('plain')]);
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [node] }] };
    run(tree);
    expect(tree.children[0].children[0]).toBe(node);
  });

  test('a link with rich content is left alone — a string body cannot hold it', () => {
    const node = link('https://ex.com/a?x=1&y=2', [{ type: 'emphasis', children: [text('see')] }]);
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [node] }] };
    run(tree);
    expect(tree.children[0].children[0]).toBe(node);
  });

  test('an empty link body falls back to the URL, and quotes are escaped', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [link('https://ex.com/a?x=1&y=2', [])] },
        { type: 'paragraph', children: [link('https://ex.com/a?q="x"&y=2', [text('q"x"')])] },
      ],
    };
    run(tree);
    expect((tree.children[0].children[0] as any).typst).toBe(
      '#link("https://ex.com/a?x=1&y=2", "https://ex.com/a?x=1&y=2")',
    );
    expect((tree.children[1].children[0] as any).typst).toBe(
      '#link("https://ex.com/a?q=\\"x\\"&y=2", "q\\"x\\"")',
    );
  });

  test('typographic quotes are undone in a URL body, kept in prose', () => {
    // MyST's smartquote transform has already run, so the AST text holds “ ”.
    const url = 'https://w.uk/shine/search?query=%22sick+note%22&page=1';
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [link(url, [text('https://w.uk/shine/search?query=“sick+note”&page=1')])] },
        { type: 'paragraph', children: [link('https://ex.com/a?x=1&y=2', [text('the “sick note” search')])] },
      ],
    };
    run(tree);
    // Straight quotes, escaped for the Typst string literal they sit in.
    expect((tree.children[0].children[0] as any).typst).toInclude('query=\\"sick+note\\"&page=1');
    expect((tree.children[0].children[0] as any).typst).not.toInclude('“');
    // Prose keeps the typography the rest of the document uses.
    expect((tree.children[1].children[0] as any).typst).toInclude('the “sick note” search');
  });

  test('links nested deeper in the tree are rewritten too', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [{ type: 'paragraph', children: [text('see '), link('https://ex.com/a?x=1&y=2', [text('here')])] }],
        },
      ],
    };
    run(tree);
    const para = (tree.children[0] as any).children[0];
    expect(para.children[1].type).toBe('raw');
  });
});
