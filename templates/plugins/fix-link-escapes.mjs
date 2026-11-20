/**
 * MyST plugin: emit links whose URL contains "&" as raw Typst (JDH-094).
 *
 * `myst-to-typst` escapes the ampersand as `\&` in both the destination string
 * and the link body. `&` is not a special character in Typst markup, so both are
 * wrong, and each breaks the link in its own way:
 *
 *   - in the destination string, Typst keeps the backslash, so the PDF link
 *     target becomes `…?q=internet\&d=ITU` and does not resolve;
 *   - in the body, the escape splits the link, and the leading fragments get a
 *     target truncated at the first `&`.
 *
 * A URL that wraps across a line therefore produces three annotations, none of
 * which works (7XSDVCtnbXva Figure 1).
 *
 * A `show link` rule in the template can only repair the destination — by then
 * the body has already been split — so the fix has to stop the escaping being
 * written at all. This transform replaces such a link with a `raw` node holding
 * `#link("<url>", "<text>")`. Passing the body as a *string* rather than markup
 * means nothing in it is interpreted, so no escaping is needed beyond `\` and
 * `"`, and characters like `_` in a URL stay literal.
 *
 * Only links whose body is plain text are rewritten; anything richer (emphasis,
 * a nested image) is left to MyST, since it cannot be expressed as a string.
 *
 * Remove this once mystmd stops escaping `&` for Typst — still present in 1.13.0.
 */

/** Quote a Typst string literal: only `\` and `"` need escaping inside one. */
function typstString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Undo MyST's typographic quotes. Its smartquote transform has already turned
 * `"` into `“”` in the AST text we copy, which is right for prose and wrong
 * inside a URL — `…?query="sick+note"` must stay as the author wrote it. Applied
 * only when the visible text is itself a URL.
 */
function unsmartenQuotes(value) {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

const LOOKS_LIKE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** The link's visible text, or null when it holds anything but plain text. */
function plainText(node) {
  const children = node.children ?? [];
  if (children.length === 0) return '';
  let text = '';
  for (const child of children) {
    if (child?.type !== 'text' || typeof child.value !== 'string') return null;
    text += child.value;
  }
  return text;
}

function rewriteLinks(tree) {
  function walk(node) {
    const children = node.children;
    if (!Array.isArray(children)) return;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || typeof child !== 'object') continue;
      if (child.type === 'link' && typeof child.url === 'string' && child.url.includes('&')) {
        const text = plainText(child);
        if (text !== null) {
          let display = text || child.url;
          if (LOOKS_LIKE_URL.test(display.trim())) display = unsmartenQuotes(display);
          children[i] = {
            type: 'raw',
            typst: `#link(${typstString(child.url)}, ${typstString(display)})`,
          };
          continue;
        }
      }
      walk(child);
    }
  }
  walk(tree);
}

const fixLinkEscapes = {
  name: 'fix-link-escapes',
  stage: 'document',
  plugin: () => (tree) => {
    rewriteLinks(tree);
  },
};

const plugin = {
  name: 'JDH Fix Link Escapes',
  transforms: [fixLinkEscapes],
};

export default plugin;
