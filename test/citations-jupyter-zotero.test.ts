import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { formatNameList, jupyterZotero } from '../src/steps/jupytext/citations-jupyter-zotero.js';

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
  expect(formatNameList([{ family: 'International Association of Sound Archives', given: '' }])).toBe(
    '{International Association of Sound Archives}',
  );
  expect(formatNameList([{ literal: 'OpenAI' }, { family: 'Hellman', given: 'Heikki' }])).toBe('{OpenAI} and Hellman, Heikki');
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
          items: { zotero: { 'g/K': { type: 'article-journal', title: 'Roundtable', DOI: '10.17104/1611-8944_2012_1_98', URL: 'https://example.org/a_b%20c' } } },
        },
      },
      cells: [],
    }),
  );
  await jupyterZotero({ article: 'article.md', notebook: 'nb.ipynb', bib: 'refs.bib', myst: 'myst.yml', dryRun: false, rewriteMd: false, updateMyst: false, stripCitationManagerComments: false, cwd: dir });
  const bib = fs.readFileSync(path.join(dir, 'refs.bib'), 'utf8');
  expect(bib).toContain('doi = {10.17104/1611-8944_2012_1_98}');
  expect(bib).toContain('url = {https://example.org/a_b%20c}');
  fs.rmSync(dir, { recursive: true, force: true });
});
