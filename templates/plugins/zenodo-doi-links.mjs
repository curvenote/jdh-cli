/**
 * MyST plugin: give Zenodo record links their DOI form, so they still resolve
 * to citations (JDH-095).
 *
 * MyST turns a link to a DOI into a citation and adds the work to the
 * bibliography. mystmd 1.10 did that for `zenodo.org/record/<id>` as well;
 * 1.13 narrowed it to explicit DOI URLs, so a Zenodo record link stays a plain
 * link and its bibliography entry disappears. In 6ig87tC5GKjQ that silently
 * dropped a reference and turned two citations into link text.
 *
 * Every Zenodo record has the DOI `10.5281/zenodo.<record id>`, so rewriting
 * the URL restores the citation without touching the author's text — the
 * displayed link text is untouched, and MyST replaces the node with a citation
 * exactly as it did before.
 *
 * Only bare record URLs are rewritten. A link to a community, a search, a file
 * inside a record or anything else on zenodo.org keeps its URL, because the
 * DOI pattern does not apply to it.
 */

/** `https://zenodo.org/record/8178990` (or `/records/`) → its DOI, else null. */
export function zenodoDoiUrl(url) {
  const match = /^https?:\/\/(?:www\.)?zenodo\.org\/records?\/(\d+)\/?$/.exec(url);
  return match ? `https://doi.org/10.5281/zenodo.${match[1]}` : null;
}

function rewriteZenodoLinks(tree) {
  function walk(node) {
    if (node.type === 'link' && typeof node.url === 'string') {
      const doi = zenodoDoiUrl(node.url);
      if (doi) node.url = doi;
    }
    (node.children ?? []).forEach(walk);
  }
  walk(tree);
}

const zenodoDoiLinks = {
  name: 'zenodo-doi-links',
  stage: 'document',
  plugin: () => (tree) => {
    rewriteZenodoLinks(tree);
  },
};

const plugin = {
  name: 'JDH Zenodo DOI Links',
  transforms: [zenodoDoiLinks],
};

export default plugin;
