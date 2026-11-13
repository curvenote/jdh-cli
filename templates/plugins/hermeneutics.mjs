/**
 * MyST plugin: `hermeneutics` directive.
 *
 * Registers a colon-fenced directive
 *
 *   :::{hermeneutics}
 *   ...content...
 *   :::
 *
 * that emits a MyST `block` AST node with `kind: 'hermeneutics'`. This makes
 * hermeneutic commentary first-class in the AST so downstream renderers
 * (HTML themes, the JDH typst template, JATS, etc.) can target it via
 * `block[kind=hermeneutics]` instead of having to pattern-match on the
 * legacy jupytext `tags=["hermeneutics"]` metadata.
 *
 * The body is parsed as MyST (so prose, links, citations, fenced code blocks
 * etc. all keep working) and attached as the block's children.
 *
 * Wiring:
 * - Bundled with jdh-cli under `templates/plugins/` and copied into
 *   `_improved/plugins/` on every `improve` run.
 * - `initMystConfig` registers all bundled plugins in `project.plugins`.
 * - `improve-hermeneutics-blocks.ts` rewrites jupytext `hermeneutics` regions
 *   and tagged Python cells into `:::{hermeneutics} ... :::` blocks.
 * - A document transform inserts `raw.typst` wrappers so PDF export emits
 *   each hermeneutics block as `#hermeneutics-block[...]` (see `jdh.typ`).
 *
 * Refs:
 * - https://mystmd.org/guide/javascript-plugins
 * - https://mystmd.org/guide/plugins-ast
 * - https://mystmd.org/guide/blocks      (block AST node)
 */

const hermeneuticsDirective = {
  name: 'hermeneutics',
  doc: 'Mark a block of content (prose, code, or mixed) as hermeneutic commentary. Emits a block AST node with kind="hermeneutics".',
  body: {
    type: 'myst',
    doc: 'Block body. Parsed as MyST so prose, citations, fenced code blocks etc. all work inside.',
  },
  run(data) {
    return [
      {
        type: 'block',
        kind: 'hermeneutics',
        children: data.body ?? [],
      },
    ];
  },
};

/**
 * Document transform: wraps `block[kind=hermeneutics]` for typst export.
 *
 * Inserts `raw` nodes whose `typst` field `myst-to-typst` writes verbatim
 * (see mystmd `packages/myst-to-typst/src/index.ts`, `raw` handler).
 */
/** True if `node` holds a fenced code block anywhere inside it. */
function hasCode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'code') return true;
  return Array.isArray(node.children) && node.children.some(hasCode);
}

/**
 * A hermeneutics cell joins its neighbours only if it holds no code. A code cell
 * draws its own HERMENEUTICS CODE / END markers against the block's top and bottom
 * edges, so it needs a block of its own (JDH-074).
 */
function joinable(node) {
  return node?.type === 'block' && node.kind === 'hermeneutics' && !hasCode(node);
}

const wrapHermeneuticsForTypst = {
  name: 'wrap-hermeneutics-for-typst',
  stage: 'document',
  plugin: () => (tree) => {
    // Consecutive hermeneutics cells share one block, as on the JDH website (JDH-061):
    // the first opens `#hermeneutics-block[`, the last closes it, and the cell-number
    // markers between them land inside, so each cell keeps its number. A cell holding
    // code keeps a block of its own (JDH-074).
    const sequence = [];
    const walk = (node) => {
      if (node.type === 'block' && node.kind === 'hermeneutics') {
        sequence.push(node);
        return;
      }
      if (node.type === 'raw' && /^\s*#jdh-cell\(/.test(node.typst ?? node.value ?? '')) return;
      if (node.children) {
        node.children.forEach(walk);
        return;
      }
      sequence.push(node);
    };
    walk(tree);
    sequence.forEach((node, i) => {
      if (node.kind !== 'hermeneutics' || node.data?.hermeneuticsWrapped) return;
      node.data = { ...(node.data ?? {}), hermeneuticsWrapped: true };
      const joinedBefore = joinable(node) && joinable(sequence[i - 1]);
      const joinedAfter = joinable(node) && joinable(sequence[i + 1]);
      node.children = [
        ...(joinedBefore ? [] : [{ type: 'raw', typst: '#hermeneutics-block[\n' }]),
        ...(node.children ?? []),
        ...(joinedAfter ? [] : [{ type: 'raw', typst: '\n]' }]),
      ];
    });
  },
};

const plugin = {
  name: 'JDH Hermeneutics',
  directives: [hermeneuticsDirective],
  transforms: [wrapHermeneuticsForTypst],
};

export default plugin;
