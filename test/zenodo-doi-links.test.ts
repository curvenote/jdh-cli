import { describe, expect, test } from 'bun:test';
import plugin, { zenodoDoiUrl } from '../templates/plugins/zenodo-doi-links.mjs';

/** Just enough of an mdast node for these trees; the plugins only read these fields. */
type TestNode = {
  type: string;
  url?: string;
  value?: string;
  typst?: string;
  children?: TestNode[];
};

function run(tree: TestNode) {
  plugin.transforms[0].plugin({}, {})(tree);
  return tree;
}

const link = (url: string) => ({
  type: 'link',
  url,
  children: [{ type: 'text', value: 'TCS project' }],
});

describe('zenodo-doi-links (JDH-095)', () => {
  test('a bare record URL becomes its DOI, in either spelling', () => {
    expect(zenodoDoiUrl('https://zenodo.org/record/8178990')).toBe(
      'https://doi.org/10.5281/zenodo.8178990',
    );
    expect(zenodoDoiUrl('https://zenodo.org/records/8178990')).toBe(
      'https://doi.org/10.5281/zenodo.8178990',
    );
    expect(zenodoDoiUrl('http://www.zenodo.org/record/8178990/')).toBe(
      'https://doi.org/10.5281/zenodo.8178990',
    );
  });

  test('anything that is not a bare record is left alone', () => {
    // A file inside a record, a community and a search do not carry that DOI.
    expect(zenodoDoiUrl('https://zenodo.org/record/8178990/files/data.csv')).toBeNull();
    expect(zenodoDoiUrl('https://zenodo.org/communities/digital-history')).toBeNull();
    expect(zenodoDoiUrl('https://zenodo.org/search?q=borders')).toBeNull();
    expect(zenodoDoiUrl('https://example.org/record/8178990')).toBeNull();
    expect(zenodoDoiUrl('https://doi.org/10.5281/zenodo.8178990')).toBeNull();
  });

  test('the transform rewrites the URL and leaves the link text as the author wrote it', () => {
    const node = link('https://zenodo.org/record/8178990');
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [node] }] };
    run(tree);
    expect(node.url).toBe('https://doi.org/10.5281/zenodo.8178990');
    expect(node.children[0].value).toBe('TCS project');
  });

  test('links deeper in the tree are rewritten too, others untouched', () => {
    const inner = link('https://zenodo.org/record/1');
    const other = link('https://example.org/page?a=1');
    const tree = {
      type: 'root',
      children: [
        { type: 'blockquote', children: [{ type: 'paragraph', children: [inner, other] }] },
      ],
    };
    run(tree);
    expect(inner.url).toBe('https://doi.org/10.5281/zenodo.1');
    expect(other.url).toBe('https://example.org/page?a=1');
  });
});
