import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  articleIdFromName,
  articleUrl,
  doiFromArticleRecord,
  lookupDoi,
  normalizeDoi,
  setJdhArticleMetadata,
} from '../src/steps/common/set-jdh-article-metadata.js';
import { readYaml } from '../src/steps/shared/yaml-doc.js';

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

  test('accepts a registered DOI in the doi field', () => {
    expect(doiFromArticleRecord({ doi: '10.1515/JDH-2024-0005' })).toBe('10.1515/jdh-2024-0005');
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
    expect(readYaml(myst)).toEqual({
      version: 1,
      project: {
        id: 'abc',
        doi: '10.1515/jdh-2025-0002',
        social: { github: 'jdh', url: 'https://example.org/article' },
      },
    });
  });

  test('adds doi and social.url when myst.yml has neither', async () => {
    const { root, workdir, myst } = setup('BHmHNQKJaSWT');
    fs.writeFileSync(myst, 'version: 1\nproject:\n  id: abc\n');
    await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: '10.1515/jdh-2025-0002',
      url: 'https://example.org/article',
    });
    expect(readYaml(myst)).toEqual({
      version: 1,
      project: { id: 'abc', doi: '10.1515/jdh-2025-0002', social: { url: 'https://example.org/article' } },
    });
  });

  test('url falls back to the article URL from the folder name', async () => {
    const { root, workdir, myst } = setup('BHmHNQKJaSWT');
    await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: '10.1515/jdh-2025-0002',
    });
    expect(readYaml<{ project: { social: { url: string } } }>(myst).project.social.url).toBe(
      articleUrl('BHmHNQKJaSWT'),
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

describe('lookupDoi (JDH API)', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  async function run(respond: () => Promise<Response>): Promise<{ doi: string | null; out: string; urls: string[] }> {
    const urls: string[] = [];
    const fetchStub = async (input: string) => {
      urls.push(input);
      return respond();
    };
    const write = process.stdout.write;
    let out = '';
    process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
    try {
      const doi = await lookupDoi('6ig87tC5GKjQ', fetchStub);
      return { doi, out, urls };
    } finally {
      process.stdout.write = write;
    }
  }

  test('requests ?format=json and returns the registered DOI from citation.URL', async () => {
    const { doi, out, urls } = await run(async () =>
      json({ doi: '10.1515/JDH.2023.0020.R2', citation: { URL: 'https://doi.org/10.1515/JDH-2023-0020?locatt=x' } }),
    );
    expect(urls).toEqual(['https://journalofdigitalhistory.org/api/articles/6ig87tC5GKjQ/?format=json']);
    expect(doi).toBe('10.1515/jdh-2023-0020');
    expect(out).toBe('');
  });

  test('notes a DOI converted from the manuscript id', async () => {
    const { doi, out } = await run(async () => json({ doi: '10.1515/JDH.2023.0001' }));
    expect(doi).toBe('10.1515/jdh-2023-0001');
    expect(out).toContain('converted from the manuscript id');
  });

  test('warns when the API is unreachable', async () => {
    const { doi, out } = await run(async () => {
      throw new TypeError('fetch failed');
    });
    expect(doi).toBeNull();
    expect(out).toBe('Warning: could not reach the JDH API (fetch failed); building without a DOI. Pass --doi to set one.\n');
  });

  test('warns when the article is not found', async () => {
    const { doi, out } = await run(async () => json({ detail: 'No Article matches the given query.' }, 404));
    expect(doi).toBeNull();
    expect(out).toContain('Warning: article 6ig87tC5GKjQ is not in the JDH API (HTTP 404)');
  });

  test('warns when the article is not public yet', async () => {
    const { out } = await run(async () => json({ detail: 'Authentication credentials were not provided.' }, 403));
    expect(out).toContain('is not public in the JDH API yet (HTTP 403)');
  });

  test('warns on other HTTP errors and on a non-JSON body', async () => {
    expect((await run(async () => new Response('oops', { status: 502 }))).out).toContain('returned HTTP 502');
    expect((await run(async () => new Response('<html>', { status: 200 }))).out).toContain('is not JSON');
  });

  test('warns when the doi field is missing or unrecognised', async () => {
    const missing = await run(async () => json({ title: 'x' }));
    expect(missing.doi).toBeNull();
    expect(missing.out).toContain('has no usable DOI (doi field missing)');
    const odd = await run(async () => json({ doi: 'pending' }));
    expect(odd.out).toContain('has no usable DOI (doi field: "pending")');
  });
});

describe('setJdhArticleMetadata with the API', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  function setup(): { root: string; workdir: string; myst: string } {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-meta-'));
    const root = path.join(tmpDir, '6ig87tC5GKjQ');
    const workdir = path.join(root, '_improved');
    fs.mkdirSync(workdir, { recursive: true });
    const myst = path.join(workdir, 'myst.yml');
    fs.writeFileSync(myst, 'version: 1\nproject:\n  id: abc\n');
    return { root, workdir, myst };
  }

  test('--doi wins without a network call', async () => {
    const { root, workdir } = setup();
    let calls = 0;
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: '10.1515/jdh-2099-0001',
      fetch: async () => {
        calls++;
        return new Response('{}');
      },
    });
    expect(calls).toBe(0);
    expect(result.doi).toBe('10.1515/jdh-2099-0001');
  });

  test('sets the DOI from the API record', async () => {
    const { root, workdir, myst } = setup();
    await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      fetch: async () => new Response(JSON.stringify({ citation: { URL: 'https://doi.org/10.1515/JDH-2023-0020' } })),
    });
    expect(readYaml<{ project: { doi: string } }>(myst).project.doi).toBe('10.1515/jdh-2023-0020');
  });

  test('without a DOI, still sets the URL', async () => {
    const { root, workdir, myst } = setup();
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      fetch: async () => new Response('{}', { status: 404 }),
    });
    expect(result).toEqual({ doi: null, url: articleUrl('6ig87tC5GKjQ') });
    expect(readYaml<{ project: Record<string, unknown> }>(myst).project.doi).toBeUndefined();
  });
});
