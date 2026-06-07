/**
 * MyST plugin: narrative code styling for Typst export.
 *
 * Wraps eligible block-level `code` nodes with `#narrative-code-block[...]` so
 * jdh-typst-template can render gray full-bleed code (see `jdh.typ`).
 *
 * Eligible code:
 * - Untagged fenced blocks anywhere in the document (except exclusions below)
 * - Blocks tagged `narrative` (same styling; tag is optional explicit intent)
 *
 * Excluded:
 * - Code inside `block[kind=hermeneutics]` (hermeneutics plugin + template)
 * - Figure boilerplate (`code:fig:*` labels) — removed by hide-figure-code.mjs
 *
 * Refs: https://mystmd.org/guide/javascript-plugins
 */

/** @param {import('myst-common').SelectAll} selectAll */
function hermeneuticsCodeNodes(selectAll, tree) {
  try {
    return new Set(selectAll('block[kind=hermeneutics] code', tree));
  } catch {
    const blocks = selectAll('block', tree).filter((n) => n.kind === 'hermeneutics');
    const codes = [];
    for (const block of blocks) {
      codes.push(...selectAll('code', block));
    }
    return new Set(codes);
  }
}

function isFigureCodeLabel(value) {
  return typeof value === 'string' && value.startsWith('code:fig:');
}

/** Walk the tree and wrap eligible block `code` nodes for Typst. */
function wrapNarrativeCode(tree, utils) {
  const skip = hermeneuticsCodeNodes(utils.selectAll, tree);

  /** @param {unknown[]} children */
  function walk(children) {
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (!node || typeof node !== 'object') continue;

      if (node.type === 'code') {
        if (skip.has(node)) continue;
        if (node.data?.narrativeCodeWrapped) continue;
        if (isFigureCodeLabel(node.identifier) || isFigureCodeLabel(node.label)) continue;

        node.data = { ...(node.data ?? {}), narrativeCodeWrapped: true };
        children.splice(
          i,
          1,
          { type: 'raw', typst: '#narrative-code-block[\n' },
          node,
          { type: 'raw', typst: '\n]' },
        );
        i += 2;
        continue;
      }

      if (Array.isArray(node.children)) {
        walk(node.children);
      }
    }
  }

  if (Array.isArray(tree.children)) {
    walk(tree.children);
  }
}

const wrapNarrativeCodeForTypst = {
  name: 'wrap-narrative-code-for-typst',
  stage: 'document',
  plugin: (_, utils) => (tree) => {
    wrapNarrativeCode(tree, utils);
  },
};

const plugin = {
  name: 'JDH Narrative Code',
  transforms: [wrapNarrativeCodeForTypst],
};

export default plugin;
