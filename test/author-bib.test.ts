import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  authorBibWorkdirName,
  findAuthorEntry,
  loadAuthorBibEntries,
} from '../src/steps/shared/author-bib.js';
import {
  citeVisibleText,
  jupyterZotero,
  rewriteMdCitationsToMyst,
  zoteroIdsFromCiteHtml,
} from '../src/steps/jupytext/citations-jupyter-zotero.js';
import { readYaml } from '../src/steps/shared/yaml-doc.js';

const AUTHOR_BIB = `@article{Meadows2023,
  author = {Meadows, R. Darrell and Sternfeld, Joshua},
  title = {Artificial Intelligence and the Practice of History},
  journal = {American Historical Review},
  year = {2023},
  doi = {10.1093/ahr/rhad362}
}
@book{Graham2015,
  author = {Graham, Shawn},
  title = {Exploring Big Historical Data},
  year = {2015}
}
`;

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function mkTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-bib-'));
  return tmpDir;
}

describe('author .bib entries', () => {
  test('match Zotero items by DOI, else by title and year', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'direct.bib'), AUTHOR_BIB);
    const { entries, usableFiles } = loadAuthorBibEntries(dir, ['direct.bib']);
    expect(usableFiles).toEqual(['direct.bib']);

    expect(
      findAuthorEntry(
        { doi: 'https://doi.org/10.1093/AHR/rhad362', title: null, year: null },
        entries,
      )?.key,
    ).toBe('Meadows2023');
    expect(
      findAuthorEntry({ doi: null, title: 'Exploring big historical data!', year: '2015' }, entries)
        ?.key,
    ).toBe('Graham2015');
    expect(
      findAuthorEntry({ doi: null, title: 'Exploring big historical data', year: '2016' }, entries),
    ).toBeNull();
  });

  test('reports files without entries', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'empty.bib'), '');
    expect(loadAuthorBibEntries(dir, ['empty.bib'])).toEqual({
      entries: [],
      usableFiles: [],
      emptyFiles: ['empty.bib'],
    });
  });

  test('an author file called references.bib is renamed in the workdir', () => {
    expect(authorBibWorkdirName('references.bib')).toBe('references.author.bib');
    expect(authorBibWorkdirName('direct.bib')).toBe('direct.bib');
  });
});

describe('rewriteMdCitationsToMyst', () => {
  // JZx9gw7iwGxb pattern: the plugin mapping for "tnaq8" is empty.
  const cite = (id: string, key: string, text: string) =>
    `<cite id="${id}"><a href="#zotero%7C20666258%2F${key}">${text}</a></cite>`;

  test('uses the mapping, then the Zotero key in the link, then plain text', () => {
    const md = [
      `A (${cite('tfptr', '37INR4W2', '(Rosenzweig, 2003)')}).`,
      `B (${cite('tnaq8', 'PCJH9RBZ', '(Meadows &#38; Sternfeld, 2023)')}).`,
      `C (${cite('h0o74', 'M64T96PV', '(Missing, 2020)')}).`,
    ].join('\n');
    const keys: Record<string, string> = {
      '20666258/37INR4W2': 'Rosenzweig2003',
      '20666258/PCJH9RBZ': 'Meadows2023',
    };
    const { md: out, unresolved } = rewriteMdCitationsToMyst(
      md,
      new Map([
        ['tfptr', [{ source: 'zotero', id: '20666258/37INR4W2' }]],
        ['tnaq8', []],
      ]),
      (id) => keys[id],
    );
    expect(out).toBe(
      ['A [@Rosenzweig2003].', 'B [@Meadows2023].', 'C (Missing, 2020).'].join('\n'),
    );
    expect(unresolved).toEqual(['(Missing, 2020)']);
  });

  // JDH-076: a group of citations the author wrapped in one pair of parentheses must
  // not end up with a second pair of its own.
  describe('a parenthesised group of citations', () => {
    const keys: Record<string, string> = {
      '20666258/XX4NZQSF': 'Terras2015',
      '20666258/VRE8WZEV': 'Ruhse2017',
    };
    const resolve = (id: string) => keys[id];

    test('merges into one citation when the author separated them with semicolons', () => {
      const md = `Public (${cite('xi7s3', 'XX4NZQSF', '[NO_PRINTED_FORM]')}; ${cite('p1jqs', 'VRE8WZEV', '[NO_PRINTED_FORM]')}).`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), resolve);
      expect(out).toBe('Public [@Terras2015; @Ruhse2017].');
    });

    test('merges them when the author separated them with commas', () => {
      const md = `Public (${cite('xi7s3', 'XX4NZQSF', '[NO_PRINTED_FORM]')}, ${cite('p1jqs', 'VRE8WZEV', '[NO_PRINTED_FORM]')}).`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), resolve);
      expect(out).toBe('Public [@Terras2015; @Ruhse2017].');
    });

    test('drops each unresolved citation’s own parentheses and separates with a semicolon', () => {
      const md = `(${cite('tjh4i', '8337629H', '(Boisvert, 2000)')}, ${cite('lecos', 'JQCJ539L', '(Boisvert, 2015)')}) highlights`;
      const { md: out, unresolved } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe('(Boisvert, 2000; Boisvert, 2015) highlights');
      expect(unresolved).toEqual(['(Boisvert, 2000)', '(Boisvert, 2015)']);
    });

    test('turns a resolved citation’s locator into a MyST supplement', () => {
      const md = `period.” (${cite('zz0', 'MILL2019', '[NO_PRINTED_FORM]')}, 3). This`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), () => 'Milligan2019');
      expect(out).toBe('period.” [@Milligan2019, 3]. This');
    });

    test('keeps a page locator inside the one pair of parentheses', () => {
      const md = `words.” (${cite('zz1', 'NOPE1111', '(Milligan, 2019)')}, 3). Next`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe('words.” (Milligan, 2019, 3). Next');
    });

    test('keeps a page range locator too', () => {
      const md = `output (${cite('zz2', 'NOPE2222', '(Perrin & Piot, 2024)')}, pp. 50-52), a dynamic`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe('output (Perrin & Piot, 2024, pp. 50-52), a dynamic');
    });

    test('leaves a citation inside a longer parenthesised sentence alone', () => {
      const md = `A (as argued ${cite('zz3', 'NOPE3333', '(Smith, 2020)')} and later).`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe('A (as argued (Smith, 2020) and later).');
    });

    test('leaves a parenthesised aside beside a citation alone', () => {
      const md = `Memory (specific to humans) (${cite('abc12', 'NOPE1111', '(Compagno, 2025)')}).`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe('Memory (specific to humans) (Compagno, 2025).');
    });

    test('leaves a citation the author did not wrap in parentheses alone', () => {
      const md = `A (note) and ${cite('abc12', 'NOPE1111', '(Smith, 2020)')} (later).`;
      const { md: out } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe('A (note) and (Smith, 2020) (later).');
    });
  });

  // JDH-080: cite2c leaves an empty <cite data-cite="…"></cite>; the item id is the
  // attribute itself, and the author writes the locator without a comma.
  describe('a cite2c marker', () => {
    const c2 = (id: string) => `<cite data-cite="${id}"></cite>`;
    const run = (md: string, resolve: (id: string) => string | undefined = () => 'KeyA') =>
      rewriteMdCitationsToMyst(md, new Map(), resolve).md;

    test('becomes a MyST citation, dropping the author’s parentheses', () => {
      expect(run(`form (${c2('1787664/QEP4R77C')}).`)).toBe('form [@KeyA].');
    });

    test('takes a locator written without a comma', () => {
      expect(run(`cannot’ (${c2('A')} p. iii).`)).toBe('cannot’ [@KeyA, p. iii].');
      expect(run(`term (${c2('A')} esp. p. 67).`)).toBe('term [@KeyA, esp. p. 67].');
      expect(run(`Milligan (${c2('A')} esp. pp. 205–10).`)).toBe(
        'Milligan [@KeyA, esp. pp. 205–10].',
      );
    });

    test('still takes one written with a comma', () => {
      expect(run(`sick (${c2('A')}, p. 199).`)).toBe('sick [@KeyA, p. 199].');
    });

    test('takes a locator that is a reference rather than a page', () => {
      expect(run(`benefits (${c2('A')} 22 July 1997 vol 298 col 793).`)).toBe(
        'benefits [@KeyA, 22 July 1997 vol 298 col 793].',
      );
    });

    test('does not mistake ordinary prose for a locator', () => {
      expect(run(`a point ([@Existing] and others disagree).`)).toBe(
        'a point ([@Existing] and others disagree).',
      );
    });

    test('moves a group’s prefix inside the citation', () => {
      const keys: Record<string, string> = { A: 'Crane2018', B: 'MoldEtAl2019' };
      expect(run(`form (e.g. ${c2('A')}, ${c2('B')}).`, (id) => keys[id])).toBe(
        'form [e.g. @Crane2018; @MoldEtAl2019].',
      );
      expect(run(`potential (see ${c2('A')}, ${c2('B')}).`, (id) => keys[id])).toBe(
        'potential [see @Crane2018; @MoldEtAl2019].',
      );
    });

    test('lifts a group with a locator or connective between the citations', () => {
      const keys: Record<string, string> = { A: 'KeyA', B: 'KeyB', C: 'KeyC' };
      const r = (md: string) => run(md, (id) => keys[id]);
      expect(r(`Europe”’ (${c2('A')}, 1085; ${c2('B')}).`)).toBe('Europe”’ [@KeyA, 1085; @KeyB].');
      expect(r(`belonging’ (${c2('A')}; see also ${c2('B')}, ${c2('C')}).`)).toBe(
        'belonging’ [@KeyA; see also @KeyB; @KeyC].',
      );
      expect(r(`Italians.’ (${c2('A')}, 234; see also ${c2('B')}).`)).toBe(
        'Italians.’ [@KeyA, 234; see also @KeyB].',
      );
      // "and" between keys is not MyST syntax; Typst refuses to build on it.
      expect(r(`Italy (see also ${c2('A')} and ${c2('B')}, 30–49).`)).toBe(
        'Italy [see also @KeyA; @KeyB, 30–49].',
      );
    });

    test('leaves a longer parenthesised aside alone', () => {
      expect(run(`A (as argued at length in that chapter ${c2('A')} and later).`)).toBe(
        'A (as argued at length in that chapter [@KeyA] and later).',
      );
    });

    test('is left in place when its id is in no bibliography', () => {
      const md = `form (${c2('1787664/MISSING')}).`;
      const { md: out, unresolved } = rewriteMdCitationsToMyst(md, new Map(), () => undefined);
      expect(out).toBe(md);
      expect(unresolved).toEqual(['1787664/MISSING']);
    });
  });

  test('reads Zotero ids and visible text from cite HTML', () => {
    expect(
      zoteroIdsFromCiteHtml('<a href="#zotero%7C1%2FAB12">x</a><a href="#zotero|2/CD34">y</a>'),
    ).toEqual(['1/AB12', '2/CD34']);
    expect(citeVisibleText('<a href="#x">(Meadows &#38; Sternfeld, 2023)</a>')).toBe(
      '(Meadows & Sternfeld, 2023)',
    );
  });
});

describe('jupyterZotero with author .bib files', () => {
  function setup(): string {
    const dir = mkTmp();
    const nb = {
      metadata: {
        'citation-manager': {
          items: {
            zotero: {
              '1/AAA': {
                id: '1/AAA',
                type: 'article-journal',
                title: 'Artificial intelligence and the practice of history',
                DOI: '10.1093/ahr/rhad362',
                issued: { 'date-parts': [[2023]] },
                author: [{ family: 'Meadows', given: 'R.' }],
              },
              '1/BBB': {
                id: '1/BBB',
                type: 'book',
                title: 'Clio Wired',
                issued: { 'date-parts': [[2011]] },
                author: [{ family: 'Rosenzweig', given: 'Roy' }],
              },
            },
          },
        },
      },
      cells: [],
    };
    fs.writeFileSync(path.join(dir, 'article.ipynb'), JSON.stringify(nb));
    fs.writeFileSync(
      path.join(dir, 'article.md'),
      '<!-- #region citation-manager={"citations": {"c1": [{"id": "1/AAA", "source": "zotero"}], "c2": [{"id": "1/BBB", "source": "zotero"}]}} -->\n' +
        'See (<cite id="c1"><a href="#zotero%7C1%2FAAA">(Meadows, 2023)</a></cite>) and (<cite id="c2"><a href="#zotero%7C1%2FBBB">(Rosenzweig, 2011)</a></cite>).\n<!-- #endregion -->\n',
    );
    fs.writeFileSync(path.join(dir, 'myst.yml'), 'version: 1\nproject:\n  id: x\n');
    fs.writeFileSync(path.join(dir, 'direct.bib'), AUTHOR_BIB);
    return dir;
  }

  const run = (cwd: string, zotero = true) =>
    jupyterZotero({
      article: 'article.md',
      notebook: 'article.ipynb',
      bib: 'references.bib',
      myst: 'myst.yml',
      dryRun: false,
      rewriteMd: true,
      updateMyst: true,
      stripCitationManagerComments: false,
      zotero,
      cwd,
    });

  test('the author entry replaces a duplicate Zotero item', async () => {
    const dir = setup();
    await run(dir);
    const bib = fs.readFileSync(path.join(dir, 'references.bib'), 'utf8');
    expect(bib).toContain('% Entries: 1');
    expect(bib).not.toContain('Artificial intelligence');
    const md = fs.readFileSync(path.join(dir, 'article.md'), 'utf8');
    expect(md).toContain('See [@Meadows2023] and [@');
    expect(
      readYaml<{ project: { bibliography: string[] } }>(path.join(dir, 'myst.yml')).project
        .bibliography,
    ).toEqual(['references.bib', 'direct.bib']);
  });

  test('--no-zotero uses only the author .bib; <cite> tags become plain text', async () => {
    const dir = setup();
    await run(dir, false);
    expect(fs.existsSync(path.join(dir, 'references.bib'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'article.md'), 'utf8')).toContain(
      'See (Meadows, 2023) and (Rosenzweig, 2011).',
    );
    expect(
      readYaml<{ project: { bibliography: string[] } }>(path.join(dir, 'myst.yml')).project
        .bibliography,
    ).toEqual(['direct.bib']);
  });

  test('an empty author .bib is not registered', async () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, 'direct.bib'), '');
    await run(dir);
    expect(
      readYaml<{ project: { bibliography: string[] } }>(path.join(dir, 'myst.yml')).project
        .bibliography,
    ).toEqual(['references.bib']);
  });
});

// JDH-080: cite2c keeps the bibliography in notebook metadata, with its own date shape.
describe('jupyterZotero with cite2c notebook metadata', () => {
  function setup(): string {
    const dir = mkTmp();
    const nb = {
      metadata: {
        cite2c: {
          citations: {
            '1787664/2BY9KDLI': {
              id: '1787664/2BY9KDLI',
              type: 'article-journal',
              title: 'Can Compulsory Dialogues Nudge Sick-listed Workers Back to Work?',
              'container-title': 'Economic Journal',
              DOI: '10.1111/ecoj.12468',
              // cite2c's own date shape: not CSL "date-parts".
              issued: { year: 2018, month: 5 },
              author: [{ family: 'Markussen', given: 'Simen' }],
            },
            '1787664/NODATE': {
              id: '1787664/NODATE',
              type: 'webpage',
              title: 'The Twenty Year Rule',
              author: [{ family: 'The National Archives', given: '' }],
            },
          },
        },
      },
      cells: [],
    };
    fs.writeFileSync(path.join(dir, 'article.ipynb'), JSON.stringify(nb));
    fs.writeFileSync(
      path.join(dir, 'article.md'),
      'Absence (<cite data-cite="1787664/2BY9KDLI"></cite> p. 1290) and rules ' +
        '(<cite data-cite="1787664/NODATE"></cite>).\n',
    );
    fs.writeFileSync(path.join(dir, 'myst.yml'), 'version: 1\nproject:\n  id: x\n');
    fs.writeFileSync(path.join(dir, 'direct.bib'), AUTHOR_BIB);
    return dir;
  }

  const run = (cwd: string) =>
    jupyterZotero({
      article: 'article.md',
      notebook: 'article.ipynb',
      bib: 'references.bib',
      myst: 'myst.yml',
      dryRun: false,
      rewriteMd: true,
      updateMyst: true,
      stripCitationManagerComments: false,
      zotero: true,
      cwd,
    });

  test('the {year, month, day} date becomes a BibTeX year', async () => {
    const dir = setup();
    await run(dir);
    const bib = fs.readFileSync(path.join(dir, 'references.bib'), 'utf8');
    expect(bib).toContain('cite2c');
    expect(bib).toContain('year = {2018}');
    expect(bib).toContain('Economic Journal');
  });

  test('an entry with no date still produces a BibTeX entry', async () => {
    const dir = setup();
    await run(dir);
    const bib = fs.readFileSync(path.join(dir, 'references.bib'), 'utf8');
    expect(bib).toContain('The Twenty Year Rule');
    expect(bib).toContain('% Entries: 2');
  });

  test('markers become MyST citations, locator and all', async () => {
    const dir = setup();
    await run(dir);
    const md = fs.readFileSync(path.join(dir, 'article.md'), 'utf8');
    expect(md).not.toContain('data-cite');
    expect(md).toMatch(/Absence \[@[^\],]+, p\. 1290\] and rules \[@[^\]]+\]\./);
  });

  test('the generated bib is registered beside the author’s own', async () => {
    const dir = setup();
    await run(dir);
    expect(
      readYaml<{ project: { bibliography: string[] } }>(path.join(dir, 'myst.yml')).project
        .bibliography,
    ).toEqual(['references.bib', 'direct.bib']);
  });
});
