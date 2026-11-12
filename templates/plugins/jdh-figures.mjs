/**
 * MyST plugin: figures at the full text width.
 *
 * MyST's Typst export gives an image with no width 90% of the column, so figures
 * stopped short of the text's right edge while placeholders (set to 100%, JDH-023)
 * reached it. This transform gives every figure image without a width 100%, so
 * figures, placeholders and text line up. A width the author set is kept.
 *
 * Refs: https://mystmd.org/guide/javascript-plugins
 */

/** @param {import('myst-common').GenericNode} node @param {boolean} inFigure */
function widen(node, inFigure) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'image' && inFigure && !node.width) node.width = '100%';
  const figure = inFigure || (node.type === 'container' && node.kind === 'figure');
  if (Array.isArray(node.children)) node.children.forEach((child) => widen(child, figure));
}

const fullWidthFigures = {
  name: 'jdh-full-width-figures',
  stage: 'document',
  plugin: () => (tree) => widen(tree, false),
};

const plugin = {
  name: 'JDH figures',
  transforms: [fullWidthFigures],
};

export default plugin;
