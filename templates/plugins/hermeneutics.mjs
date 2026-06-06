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
const wrapHermeneuticsForTypst = {
  name: 'wrap-hermeneutics-for-typst',
  stage: 'document',
  plugin: (_, utils) => (tree) => {
    utils.selectAll('block', tree).forEach((node) => {
      if (node.kind !== 'hermeneutics' || node.data?.hermeneuticsWrapped) return;
      node.data = { ...(node.data ?? {}), hermeneuticsWrapped: true };
      node.children = [
        { type: 'raw', typst: '#hermeneutics-block[\n' },
        ...(node.children ?? []),
        { type: 'raw', typst: '\n]' },
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
