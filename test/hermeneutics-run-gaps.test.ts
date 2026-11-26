import { describe, expect, test } from 'bun:test';
import plugin from '../templates/plugins/hermeneutics.mjs';

type Node = {
  type: string;
  kind?: string;
  value?: string;
  url?: string;
  typst?: string;
  data?: Record<string, unknown>;
  children?: Node[];
};

const herm = (...children: Node[]): Node => ({ type: 'block', kind: 'hermeneutics', children });
const prose = (value = 'Some writing between two tagged cells.'): Node => ({ type: 'text', value });
const image = (url = 'media/cartoon.png'): Node => ({ type: 'image', url });
const caption = (value = 'Figure 3 A cartoon'): Node => ({ type: 'text', value });
const ws = (): Node => ({ type: 'text', value: '\n' });
const code = (): Node => ({ type: 'code', value: 'x = 1' });

function run(...children: Node[]): Node {
  const tree: Node = { type: 'root', children };
  plugin.transforms[0].plugin({}, {})(tree);
  return tree;
}

/** The opening/closing wrappers each hermeneutics block ended up with. */
function brackets(tree: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.type === 'raw' && n.typst?.includes('hermeneutics-block[')) out.push('[');
    else if (n.type === 'raw' && n.typst?.trim() === ']') out.push(']');
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}

/**
 * JDH-092. The hermeneutics tag is not applied consistently: 6ig87tC5GKjQ has figures
 * sitting untagged between tagged cells, which split one run and left the figures outside
 * the band. The website paints the region continuously.
 */
describe('a hermeneutics run reaches over media (JDH-092)', () => {
  test('two adjacent cells already share one block', () => {
    expect(brackets(run(herm(prose()), herm(prose())))).toEqual(['[', ']']);
  });

  test('a figure between two cells no longer splits the run', () => {
    const tree = run(herm(prose()), image(), caption(), herm(prose()));
    // One block open, one close: the figure and its caption fall inside it.
    expect(brackets(tree)).toEqual(['[', ']']);
  });

  test("a figure's caption may carry line breaks", () => {
    const tree = run(
      herm(prose()),
      image(),
      caption(),
      { type: 'break' },
      caption('rations for the citizen science experiment'),
      herm(prose()),
    );
    expect(brackets(tree)).toEqual(['[', ']']);
  });

  test('several figures in a row all fall inside', () => {
    const tree = run(herm(prose()), image('a.png'), image('b.png'), image('c.png'), herm(prose()));
    expect(brackets(tree)).toEqual(['[', ']']);
  });

  test('prose between two cells still ends the run', () => {
    // Which layer a piece of writing belongs to is editorial, not something to infer from
    // its neighbours — guessing wrong paints narrative text teal.
    const tree = run(herm(prose()), prose('A paragraph of narrative.'), herm(prose()));
    expect(brackets(tree)).toEqual(['[', ']', '[', ']']);
  });

  test('prose before a figure still ends the run', () => {
    const tree = run(herm(prose()), prose('Narrative.'), image(), herm(prose()));
    expect(brackets(tree)).toEqual(['[', ']', '[', ']']);
  });

  test('a cell holding code keeps its own block (JDH-074)', () => {
    const tree = run(herm(prose()), image(), herm(code()), image(), herm(prose()));
    expect(brackets(tree)).toEqual(['[', ']', '[', ']', '[', ']']);
  });

  test('whitespace and raw directives never end a run', () => {
    const tree = run(
      herm(prose()),
      ws(),
      { type: 'raw', typst: '#figure(' },
      image(),
      { type: 'comment', value: 'x' },
      ws(),
      herm(prose()),
    );
    expect(brackets(tree)).toEqual(['[', ']']);
  });

  test('brackets stay balanced however the run is broken up', () => {
    const tree = run(
      herm(prose()),
      image(),
      herm(prose()),
      prose('Narrative.'),
      herm(prose()),
      image(),
      herm(prose()),
    );
    const b = brackets(tree);
    expect(b.filter((x) => x === '[').length).toBe(b.filter((x) => x === ']').length);
    expect(b).toEqual(['[', ']', '[', ']']);
  });

  test('a trailing figure does not leave the run open', () => {
    const tree = run(herm(prose()), image());
    expect(brackets(tree)).toEqual(['[', ']']);
  });
});
