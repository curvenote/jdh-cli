/**
 * MyST plugin: hide figure boilerplate code from export (PDF / Typst).
 *
 * Figure notebook cells are converted by `improveNotebookFigures` into a
 * `{figure}` directive only. This transform removes any legacy `{code-block}`
 * nodes labelled `code:fig:*` so `display(Image(...))` source never appears
 * in the built PDF (Option B).
 *
 * Refs: https://mystmd.org/guide/javascript-plugins
 */

const FIGURE_CODE_PREFIX = 'code:fig:';

function isFigureCodeNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (typeof node.identifier === 'string' && node.identifier.startsWith(FIGURE_CODE_PREFIX)) {
    return true;
  }
  if (typeof node.label === 'string' && node.label.startsWith(FIGURE_CODE_PREFIX)) {
    return true;
  }
  return false;
}

/** Remove matching nodes from the tree bottom-up. */
function removeFigureCodeNodes(tree) {
  /** @param {import('myst-common').GenericNode} node */
  function walk(node) {
    if (!Array.isArray(node.children)) return;
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child?.children) walk(child);
      if (isFigureCodeNode(child)) {
        node.children.splice(i, 1);
      }
    }
  }
  walk(tree);
}

const hideFigureCode = {
  name: 'hide-figure-code',
  stage: 'document',
  plugin: () => (tree) => {
    removeFigureCodeNodes(tree);
  },
};

const plugin = {
  name: 'JDH Hide Figure Code',
  transforms: [hideFigureCode],
};

export default plugin;
