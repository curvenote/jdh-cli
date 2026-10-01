import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  articleIdFromName,
  articleUrl,
  doiFromArticleRecord,
  normalizeDoi,
  setJdhArticleMetadata,
} from '../src/steps/common/set-jdh-article-metadata.js';

describe('articleIdFromName', () => {
  test('reads the id from a GitHub URL', () => {
    expect(articleIdFromName('https://github.com/jdh-observer/BHmHNQKJaSWT')).toBe('BHmHNQKJaSWT');
  });

  test('strips prefixes used by older and forked repos', () => {
    expect(articleIdFromName('jdh001-L2gBr3BzwH8Z')).toBe('L2gBr3BzwH8Z');
    expect(articleIdFromName('https://github.com/curvenote/jdh-example-BHmHNQKJaSWT.git')).toBe(
      'BHmHNQKJaSWT',
    );
  });

  test('returns null for names without an article id', () => {
    expect(articleIdFromName('jdh-cli-test-a1B2c3')).toBeNull();
    expect(articleIdFromName('my-article')).toBeNull();
  });
});

describe('doiFromArticleRecord', () => {
  test('prefers the doi.org link in citation.URL', () => {
    const record = {
      doi: '10.1515/JDH.2025.0002.R1',
      citation: { URL: 'https://doi.org/10.1515/JDH-2025-0002?locatt=label:JDHFULL' },
    };
    expect(doiFromArticleRecord(record)).toBe('10.1515/jdh-2025-0002');
  });

  test('converts the manuscript id when citation.URL is missing', () => {
    expect(doiFromArticleRecord({ doi: '10.1515/JDH.2023.0018.R2' })).toBe('10.1515/jdh-2023-0018');
    expect(doiFromArticleRecord({ doi: '10.1515/JDH.2023.0001' })).toBe('10.1515/jdh-2023-0001');
  });

  test('returns null when neither field has a DOI', () => {
    expect(doiFromArticleRecord({ doi: '', citation: {} })).toBeNull();
  });
});

describe('normalizeDoi', () => {
  test('strips doi: and doi.org prefixes', () => {
    expect(normalizeDoi('doi:10.1515/jdh-2025-0002')).toBe('10.1515/jdh-2025-0002');
    expect(normalizeDoi('https://doi.org/10.1515/jdh-2025-0002')).toBe('10.1515/jdh-2025-0002');
  });
});

describe('setJdhArticleMetadata', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  function setup(folderName: string): { root: string; workdir: string; myst: string } {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-meta-'));
    const root = path.join(tmpDir, folderName);
    const workdir = path.join(root, '_improved');
    fs.mkdirSync(workdir, { recursive: true });
    const myst = path.join(workdir, 'myst.yml');
    fs.writeFileSync(
      myst,
      'version: 1\nproject:\n  id: abc\n  doi: "10.0/old"\n  social:\n    github: jdh\n    url: "https://old.example"\n',
    );
    return { root, workdir, myst };
  }

  test('flags override lookups and replace existing values', async () => {
    const { root, workdir, myst } = setup('BHmHNQKJaSWT');
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: 'https://doi.org/10.1515/jdh-2025-0002',
      url: 'https://example.org/article',
    });
    expect(result).toEqual({ doi: '10.1515/jdh-2025-0002', url: 'https://example.org/article' });
    const content = fs.readFileSync(myst, 'utf8');
    expect(content).toContain('  doi: "10.1515/jdh-2025-0002"\n');
    expect(content).toContain('  social:\n    url: "https://example.org/article"\n    github: jdh\n');
    expect(content).not.toContain('old.example');
    expect(content).not.toContain('10.0/old');
    expect(content.match(/^ {2}doi:/gm)).toHaveLength(1);
  });

  test('url falls back to the article URL from the folder name', async () => {
    const { root, workdir, myst } = setup('BHmHNQKJaSWT');
    await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: '10.1515/jdh-2025-0002',
    });
    expect(fs.readFileSync(myst, 'utf8')).toContain(
      `    url: "${articleUrl('BHmHNQKJaSWT')}"\n`,
    );
  });

  test('leaves myst.yml untouched when nothing can be resolved', async () => {
    const { root, workdir, myst } = setup('not-an-article');
    const before = fs.readFileSync(myst, 'utf8');
    const result = await setJdhArticleMetadata({ cwd: workdir, projectRoot: root, dryRun: false });
    expect(result).toEqual({ doi: null, url: null });
    expect(fs.readFileSync(myst, 'utf8')).toBe(before);
  });
});
