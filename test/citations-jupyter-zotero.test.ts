import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import {
  accessedToUrlDate,
  formatNameList,
  jupyterZotero,
  URLDATE_NOTE_PREFIX,
} from '../src/steps/jupytext/citations-jupyter-zotero.js';

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

test('skips references.bib when the notebook has no citation-manager items', async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-zotero-'));
  fs.writeFileSync(path.join(tmpDir, 'article.ipynb'), JSON.stringify({ metadata: {}, cells: [] }));
  fs.writeFileSync(path.join(tmpDir, 'article.md'), '# Title\n');
  const myst = 'version: 1\nproject:\n  id: x\n';
  fs.writeFileSync(path.join(tmpDir, 'myst.yml'), myst);

  await jupyterZotero({
    article: 'article.md',
    notebook: 'article.ipynb',
    bib: 'references.bib',
    myst: 'myst.yml',
    dryRun: false,
    rewriteMd: true,
    updateMyst: true,
    stripCitationManagerComments: false,
    cwd: tmpDir,
  });

  expect(fs.existsSync(path.join(tmpDir, 'references.bib'))).toBe(false);
  expect(fs.readFileSync(path.join(tmpDir, 'myst.yml'), 'utf8')).toBe(myst);
});

test('organisation authors are braced so BibTeX keeps them whole (JDH-048)', () => {
  // 6EWgjJtoiW6R: APA printed "(Sound Archives, 1975)" before this.
  expect(
    formatNameList([{ family: 'International Association of Sound Archives', given: '' }]),
  ).toBe('{International Association of Sound Archives}');
  expect(formatNameList([{ literal: 'OpenAI' }, { family: 'Hellman', given: 'Heikki' }])).toBe(
    '{OpenAI} and Hellman, Heikki',
  );
  expect(formatNameList([{ family: 'Ernst & Co', given: '' }])).toBe('{Ernst \\& Co}');
});

test('DOIs and URLs are written verbatim, without escaped underscores', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-bib-'));
  fs.writeFileSync(path.join(dir, 'myst.yml'), 'version: 1\nproject: {}\n');
  fs.writeFileSync(
    path.join(dir, 'nb.ipynb'),
    JSON.stringify({
      metadata: {
        'citation-manager': {
          items: {
            zotero: {
              'g/K': {
                type: 'article-journal',
                title: 'Roundtable',
                DOI: '10.17104/1611-8944_2012_1_98',
                URL: 'https://example.org/a_b%20c',
              },
            },
          },
        },
      },
      cells: [],
    }),
  );
  await jupyterZotero({
    article: 'article.md',
    notebook: 'nb.ipynb',
    bib: 'refs.bib',
    myst: 'myst.yml',
    dryRun: false,
    rewriteMd: false,
    updateMyst: false,
    stripCitationManagerComments: false,
    cwd: dir,
  });
  const bib = fs.readFileSync(path.join(dir, 'refs.bib'), 'utf8');
  expect(bib).toContain('doi = {10.17104/1611-8944_2012_1_98}');
  expect(bib).toContain('url = {https://example.org/a_b%20c}');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Access dates (JDH-083) ---------------------------------------------------------

test('accessedToUrlDate reads the CSL accessed date as ISO', () => {
  expect(accessedToUrlDate({ accessed: { 'date-parts': [[2021, 6, 19]] } })).toBe('2021-06-19');
  // Month and day are zero-padded; a year alone is still a usable urldate.
  expect(accessedToUrlDate({ accessed: { 'date-parts': [[2021, 6]] } })).toBe('2021-06');
  expect(accessedToUrlDate({ accessed: { 'date-parts': [[2021]] } })).toBe('2021');
  expect(accessedToUrlDate({ accessed: { 'date-parts': [['2021', '12', '3']] } })).toBe(
    '2021-12-03',
  );
});

test('accessedToUrlDate rejects anything it cannot trust', () => {
  expect(accessedToUrlDate({})).toBeNull();
  expect(accessedToUrlDate({ accessed: {} })).toBeNull();
  expect(accessedToUrlDate({ accessed: { 'date-parts': [] } })).toBeNull();
  expect(accessedToUrlDate({ accessed: { 'date-parts': [[]] } })).toBeNull();
  // "n.d." and a two-digit year are not years.
  expect(accessedToUrlDate({ accessed: { 'date-parts': [['n.d.']] } })).toBeNull();
  expect(accessedToUrlDate({ accessed: { 'date-parts': [[21, 6, 19]] } })).toBeNull();
});

async function bibFor(items: Record<string, unknown>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-urldate-'));
  fs.writeFileSync(path.join(dir, 'myst.yml'), 'version: 1\nproject: {}\n');
  fs.writeFileSync(
    path.join(dir, 'nb.ipynb'),
    JSON.stringify({
      metadata: { 'citation-manager': { items: { zotero: items } } },
      cells: [],
    }),
  );
  await jupyterZotero({
    article: 'article.md',
    notebook: 'nb.ipynb',
    bib: 'refs.bib',
    myst: 'myst.yml',
    dryRun: false,
    rewriteMd: false,
    updateMyst: false,
    stripCitationManagerComments: false,
    cwd: dir,
  });
  const bib = fs.readFileSync(path.join(dir, 'refs.bib'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return bib;
}

test('the access date is written as urldate and mirrored into note', async () => {
  // MyST's bibliography rebuild keeps `note` but drops `urldate`, so the date rides
  // through the note behind a marker and the template lifts it back out.
  const bib = await bibFor({
    'g/K': {
      type: 'webpage',
      title: 'Wayback Machine APIs',
      URL: 'https://archive.org/help/wayback_api.php',
      accessed: { 'date-parts': [[2021, 6, 19]] },
    },
  });
  expect(bib).toContain('urldate = {2021-06-19}');
  expect(bib).toContain(`${URLDATE_NOTE_PREFIX}2021-06-19`);
});

test('no url or no access date means neither field', async () => {
  const noDate = await bibFor({
    'g/A': { type: 'webpage', title: 'No access date', URL: 'https://example.org/' },
  });
  expect(noDate).not.toContain('urldate');
  expect(noDate).not.toContain(URLDATE_NOTE_PREFIX);

  const noUrl = await bibFor({
    'g/B': { type: 'book', title: 'A book', accessed: { 'date-parts': [[2021, 6, 19]] } },
  });
  expect(noUrl).not.toContain('urldate');
  expect(noUrl).not.toContain(URLDATE_NOTE_PREFIX);
});

test('a cite2c access date is normalised like its issued date', async () => {
  // cite2c writes dates as {year, month, day}; without normalising `accessed` the urldate
  // was silently dropped for the three cite2c articles (JDH-083).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-cite2c-'));
  fs.writeFileSync(path.join(dir, 'myst.yml'), 'version: 1\nproject: {}\n');
  fs.writeFileSync(
    path.join(dir, 'nb.ipynb'),
    JSON.stringify({
      metadata: {
        cite2c: {
          citations: {
            'g/SHINE': {
              type: 'webpage',
              title: 'SHINE',
              URL: 'https://www.webarchive.org.uk/shine',
              accessed: { year: 2024, month: 3, day: 7 },
            },
          },
        },
      },
      cells: [],
    }),
  );
  await jupyterZotero({
    article: 'article.md',
    notebook: 'nb.ipynb',
    bib: 'refs.bib',
    myst: 'myst.yml',
    dryRun: false,
    rewriteMd: false,
    updateMyst: false,
    stripCitationManagerComments: false,
    cwd: dir,
  });
  const bib = fs.readFileSync(path.join(dir, 'refs.bib'), 'utf8');
  expect(bib).toContain('urldate = {2024-03-07}');
  expect(bib).toContain(`${URLDATE_NOTE_PREFIX}2024-03-07`);
  fs.rmSync(dir, { recursive: true, force: true });
});
