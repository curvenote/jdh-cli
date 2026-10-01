import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  extractFrontmatter,
  extractJupytextFrontmatter,
  stripOrcidMarkdownFromName,
} from '../src/steps/jupytext/extract-jupytext-frontmatter.js';
import { readYaml } from '../src/steps/shared/yaml-doc.js';

describe('stripOrcidMarkdownFromName', () => {
  test('removes ORCID badge markdown from author name', () => {
    const raw =
      'Maximilian C. Teich [![orcid](https://orcid.org/sites/default/files/images/orcid_16x16.png)](https://orcid.org/0009-0000-7084-8291)';
    expect(stripOrcidMarkdownFromName(raw)).toBe('Maximilian C. Teich');
  });

  test('leaves plain names unchanged', () => {
    expect(stripOrcidMarkdownFromName('Jane Doe')).toBe('Jane Doe');
  });
});

const ORCID_BADGE = (id: string) =>
  `[![orcid](https://orcid.org/sites/default/files/images/orcid_16x16.png)](https://orcid.org/${id})`;

// Shapes from the JDH corpus: Chronoferencing (6ig87tC5GKjQ) and MiDeVUZqdmue.
const ARTICLE = [
  '---',
  'jupyter: {}',
  '---',
  '',
  '<!-- #region tags=["title"] -->',
  '# Chronoferencing the Borderlands',
  '<!-- #endregion -->',
  '',
  '<!-- #region tags=["contributor"] -->',
  `### Machteld Venken ${ORCID_BADGE('0000-0002-0358-0827')}`,
  'University of Luxembourg',
  '<!-- #endregion -->',
  '',
  '<!-- #region tags=["contributor"] -->',
  ` ### Johanna Jaschik ${ORCID_BADGE('0000-0002-0197-6748')}`,
  'C<sup>2</sup>DH, University of Luxembourg',
  '<!-- #endregion -->',
  '',
  '<!-- #region tags=["contributor"] -->',
  '### Emmanuelle Vollenweider',
  '',
  'emmanuelle.vollenweider@hepl.ch<br/>',
  'Haute Ecole Pédagogique Vaud',
  '<!-- #endregion -->',
  '',
  '<!-- #region tags=["keywords"] -->',
  'borders, memory',
  '<!-- #endregion -->',
  '',
  'Body text.',
].join('\n');

describe('extractFrontmatter', () => {
  test('reads every contributor region, in order', () => {
    const { contributors, title, keywords } = extractFrontmatter(ARTICLE);
    expect(title).toBe('Chronoferencing the Borderlands');
    expect(keywords).toEqual(['borders', 'memory']);
    expect(contributors).toEqual([
      { name: 'Machteld Venken', orcid: '0000-0002-0358-0827', email: null, affiliationLines: ['University of Luxembourg'] },
      { name: 'Johanna Jaschik', orcid: '0000-0002-0197-6748', email: null, affiliationLines: ['C²DH, University of Luxembourg'] },
      {
        name: 'Emmanuelle Vollenweider',
        orcid: null,
        email: 'emmanuelle.vollenweider@hepl.ch',
        affiliationLines: ['Haute Ecole Pédagogique Vaud'],
      },
    ]);
  });

  test('no contributor regions: no authors', () => {
    expect(extractFrontmatter('Just text.').contributors).toEqual([]);
  });
});

describe('extractJupytextFrontmatter', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  test('writes all authors to myst.yml and removes every contributor region', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-fm-'));
    fs.writeFileSync(path.join(tmpDir, 'article.md'), ARTICLE);
    fs.writeFileSync(path.join(tmpDir, 'myst.yml'), 'version: 1\nproject:\n  id: x\n');
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await extractJupytextFrontmatter({ cwd: tmpDir, dryRun: false, orcidLookup: false });
    } finally {
      write.mockRestore();
    }

    const project = readYaml<{ project: { authors: unknown[] } }>(path.join(tmpDir, 'myst.yml')).project;
    expect(project.authors).toEqual([
      { name: 'Machteld Venken', orcid: 'https://orcid.org/0000-0002-0358-0827', affiliations: ['University of Luxembourg'] },
      { name: 'Johanna Jaschik', orcid: 'https://orcid.org/0000-0002-0197-6748', affiliations: ['C²DH, University of Luxembourg'] },
      { name: 'Emmanuelle Vollenweider', email: 'emmanuelle.vollenweider@hepl.ch', affiliations: ['Haute Ecole Pédagogique Vaud'] },
    ]);
    const md = fs.readFileSync(path.join(tmpDir, 'article.md'), 'utf8');
    expect(md).not.toContain('contributor');
    expect(md).not.toContain('Jaschik');
    expect(md).toContain('# Chronoferencing the Borderlands');
  });
});
