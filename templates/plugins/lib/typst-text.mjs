/** Escape plain text for Typst content `[...]` (shared by the JDH plugins). */

const BACKSLASH_PLACEHOLDER = 'xxxxJDHBACKSLASHxxxx';
const TILDE_PLACEHOLDER = 'xxxxJHDTILDExxxx';

/** Typst special chars inside content blocks (mirrors myst-to-typst href/text replacements). */
const TYPST_TEXT_REPLACEMENTS = {
  '&': '\\&',
  '`': '\\`',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '*': '\\*',
  '{': '\\{',
  '}': '\\}',
  '[': '\\[',
  ']': '\\]',
  '^': '\\^',
  '@': '\\@',
  ';': '\\;',
  '<': '\\<',
  '>': '\\>',
  '=': '\\=',
};

/** Escape plain text for Typst content (plugins cannot depend on myst-to-typst in tests). */
export function stringToTypstText(text) {
  const escaped = (text ?? '')
    .replace(/\\/g, BACKSLASH_PLACEHOLDER)
    .replace(/~/g, TILDE_PLACEHOLDER);
  let out = '';
  for (const char of escaped) {
    out += TYPST_TEXT_REPLACEMENTS[char] ?? char;
  }
  return out
    .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\\\')
    .replace(new RegExp(TILDE_PLACEHOLDER, 'g'), '$tilde$');
}
