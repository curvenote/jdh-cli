import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { jupyterZotero } from '../src/steps/jupytext/citations-jupyter-zotero.js';

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
