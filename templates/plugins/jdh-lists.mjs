/**
 * MyST plugin: lists for the Typst PDF (JDH-070).
 *
 * - A hard line break inside a list item (`**Question?**  ` then
 *   `*(multiple answers possible)*`) is written by myst-to-typst as ` \` and a
 *   new line at column 0, which ends the Typst list: the next item starts again
 *   at 1 (In Search of Truth questionnaire). Write the break inline instead.
 * - Task list items (`- [ ] Female`) lose their box; put an empty or ticked
 *   box in front of the text, as on the website.
 */

const BOX = '#box(width: 0.65em, height: 0.65em, stroke: 0.5pt, baseline: 0.05em)';
const TICKED = '#box(width: 0.65em, height: 0.65em, stroke: 0.5pt, baseline: 0.05em, align(center + horizon, text(size: 0.6em, sym.checkmark)))';

const listsForTypst = {
  name: 'jdh-lists-for-typst',
  stage: 'document',
  plugin: (_, utils) => (tree) => {
    utils.selectAll('listItem', tree).forEach((item) => {
      utils.selectAll('break', item).forEach((br) => {
        br.type = 'raw';
        br.typst = '#linebreak() ';
      });
      if (typeof item.checked !== 'boolean') return;
      const first = item.children?.[0];
      const target = first?.type === 'paragraph' ? first.children : item.children;
      target?.unshift({ type: 'raw', typst: `${item.checked ? TICKED : BOX}#h(0.4em)` });
      item.checked = undefined;
    });
  },
};

const plugin = {
  name: 'JDH Lists',
  transforms: [listsForTypst],
};

export default plugin;
