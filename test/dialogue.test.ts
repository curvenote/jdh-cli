import { describe, expect, test } from 'bun:test';
import plugin, { dialogueToTypst, parseDialogue } from '../templates/plugins/jdh-dialogue.mjs';
import { dialogueLabelFromTag, processArticle } from '../src/steps/jupytext/improve-dialogue-regions.js';
import { processArticle as wrapHermeneutics } from '../src/steps/jupytext/improve-hermeneutics-blocks.js';

// Shapes from Chronoferencing (6ig87tC5GKjQ): no leading pipes, &nbsp; for silence, a ragged row.
const WORLDCUP = [
  '| Priestar | Aspect |',
  '|------- | ------ |',
  '| So, who do you think about it? Who will win the World Cup? | &nbsp; |',
  '| &nbsp; | Well, Croatia, I hope. I hope Croatia, yeah yeah.',
  '| This is very bad | Because England... |',
].join('\n');

const LENGTH = ['Termine | Aura', '------ | ---', 'And euhm, what can I say? | &nbsp;', '&nbsp; | Okay.'].join('\n');

describe('parseDialogue', () => {
  test('speakers from the header, one slot per speaker per turn', () => {
    expect(parseDialogue(WORLDCUP)).toEqual({
      speakers: ['Priestar', 'Aspect'],
      rows: [
        ['So, who do you think about it? Who will win the World Cup?', null],
        [null, 'Well, Croatia, I hope. I hope Croatia, yeah yeah.'],
        ['This is very bad', 'Because England...'],
      ],
    });
  });

  test('tables without leading pipes', () => {
    expect(parseDialogue(LENGTH).rows).toEqual([
      ['And euhm, what can I say?', null],
      [null, 'Okay.'],
    ]);
  });

  test('a single speaker', () => {
    expect(parseDialogue('| Termime |\n|---|\n| A monologue. |')).toEqual({ speakers: ['Termime'], rows: [['A monologue.']] });
  });
});

test('dialogueToTypst writes Typst arrays and escapes text', () => {
  expect(dialogueToTypst({ speakers: ['A', 'B'], rows: [['Hi #1', null], [null, 'a_b']] })).toBe(
    '#jdh-dialogue(speakers: ([A], [B],), rows: (([Hi \\#1], none,), (none, [a\\_b],),))\n',
  );
});

test('the directive makes a numbered "dialogue" container; the transform attaches the Typst body', () => {
  const [node] = plugin.directives[0].run({ body: WORLDCUP, options: { label: 'dlg:worldcup' } });
  expect(node.type).toBe('container');
  expect(node.kind).toBe('dialogue');
  expect(node.identifier).toBe('dlg:worldcup');
  expect(node.children.map((c: { type: string }) => c.type)).toEqual(['caption']);

  // MyST may move non-caption children into the caption; the transform rebuilds the body.
  node.children[0].children.push({ type: 'div', children: [] });
  plugin.transforms[0].plugin({}, { selectAll: () => [node] })({ type: 'root', children: [node] });
  expect(node.children.map((c: { type: string }) => c.type)).toEqual(['caption', 'div']);
  expect(node.children[0].children.map((c: { type: string }) => c.type)).toEqual(['paragraph']);
  expect(node.children[1].children[0].typst).toStartWith('#jdh-dialogue(speakers: ([Priestar], [Aspect],)');
});

describe('improveDialogueRegions', () => {
  test('dialogueLabelFromTag', () => {
    expect(dialogueLabelFromTag('dialog-worldcup-*')).toBe('dlg:worldcup');
    expect(dialogueLabelFromTag('dialog-rich-poor-countries-*')).toBe('dlg:rich-poor-countries');
  });

  test('replaces the table in a dialog region and keeps the region markers', () => {
    const md = `Before.\n\n<!-- #region tags=["dialog-worldcup-*"] -->\n${WORLDCUP}\n<!-- #endregion -->\n\nAfter.`;
    const { content, converted } = processArticle(md);
    expect(converted).toEqual(['dlg:worldcup']);
    expect(content).toBe(
      `Before.\n\n<!-- #region tags=["dialog-worldcup-*"] -->\n\`\`\`{jdh-dialogue}\n:label: dlg:worldcup\n\n${WORLDCUP}\n\`\`\`\n<!-- #endregion -->\n\nAfter.`,
    );
  });

  test('other regions are untouched', () => {
    const md = '<!-- #region tags=["hermeneutics"] -->\nText | with a pipe\n<!-- #endregion -->';
    expect(processArticle(md).content).toBe(md);
  });

  test('a hermeneutics dialogue is still wrapped in the hermeneutics block', () => {
    const md = `<!-- #region tags=["hermeneutics", "dialog-conversation-length-*"] -->\n${LENGTH}\n<!-- #endregion -->`;
    const wrapped = wrapHermeneutics(processArticle(md).content).content;
    expect(wrapped).toStartWith(':::{hermeneutics}');
    expect(wrapped).toContain('```{jdh-dialogue}\n:label: dlg:conversation-length\n\nTermine | Aura');
    expect(wrapped.trimEnd()).toEndWith('```\n:::');
  });
});
