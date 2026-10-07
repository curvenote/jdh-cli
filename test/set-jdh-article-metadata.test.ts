import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  articleIdFromName,
  articleUrl,
  doiFromArticleRecord,
  dateFromPublicationDate,
  licenseFromCopyrightText,
  licenseFromCopyrightType,
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
      fetch: async () => new Response('{}', { status: 404 }),
    });
    expect(result).toMatchObject({ doi: '10.1515/jdh-2025-0002', url: 'https://example.org/article' });
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
      fetch: async () => new Response('{}', { status: 404 }),
    });
    expect(readYaml(myst)).toEqual({
      version: 1,
      project: { id: 'abc', doi: '10.1515/jdh-2025-0002', social: { url: 'https://example.org/article' } },
    });
  });

  test('url falls back to the article URL from the folder name', async () => {
    const { root, workdir, myst } = setup('BHmHNQKJaSWT');
    fs.writeFileSync(myst, 'version: 1\nproject:\n  id: abc\n');
    await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: '10.1515/jdh-2025-0002',
      fetch: async () => new Response('{}', { status: 404 }),
    });
    expect(readYaml<{ project: { social: { url: string } } }>(myst).project.social.url).toBe(
      articleUrl('BHmHNQKJaSWT'),
    );
  });

  test('leaves myst.yml untouched when nothing can be resolved', async () => {
    const { root, workdir, myst } = setup('not-an-article');
    fs.writeFileSync(myst, 'version: 1\nproject:\n  id: abc\n');
    const before = fs.readFileSync(myst, 'utf8');
    const result = await setJdhArticleMetadata({ cwd: workdir, projectRoot: root, dryRun: false });
    expect(result).toEqual({ doi: null, url: null, date: null, license: null, issue: null });
    expect(fs.readFileSync(myst, 'utf8')).toBe(before);
  });

  test('a DOI and URL already in myst.yml (from the repo) are kept; the API fills only the rest (JDH-012)', async () => {
    const { root, workdir, myst } = setup('BHmHNQKJaSWT');
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      fetch: async () =>
        new Response(JSON.stringify({ citation: { URL: 'https://doi.org/10.1515/JDH-2099-0001' }, publication_date: '2025-07-24T10:07:42+02:00' })),
    });
    expect(result).toMatchObject({ doi: '10.0/old', url: 'https://old.example', date: '2025-07-24' });
    expect(readYaml<{ project: { doi: string } }>(myst).project.doi).toBe('10.0/old');
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

  test('--doi wins over the API record', async () => {
    const { root, workdir } = setup();
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      doi: '10.1515/jdh-2099-0001',
      fetch: async () => new Response(JSON.stringify({ citation: { URL: 'https://doi.org/10.1515/JDH-2023-0020' } })),
    });
    expect(result.doi).toBe('10.1515/jdh-2099-0001');
  });

  test('date, licence, issue and the article URL export option come from the record (JDH-041)', async () => {
    const { root, workdir, myst } = setup();
    fs.writeFileSync(
      path.join(workdir, 'meta-jdh.yml'),
      'version: 1\nproject:\n  license: CC-BY-NC-ND-4.0\n  exports:\n    - format: pdf\n      template: ../jdh-typst-template\n',
    );
    let calls = 0;
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            citation: { URL: 'https://doi.org/10.1515/JDH-2023-0020' },
            publication_date: '2025-03-20T08:43:43+01:00',
            copyright_type: 'CC_BY',
            issue: { name: 'Varia', pid: 'jdh004' },
          }),
        );
      },
    });
    expect(calls).toBe(1);
    expect(result).toEqual({
      doi: '10.1515/jdh-2023-0020',
      url: articleUrl('6ig87tC5GKjQ'),
      date: '2025-03-20',
      license: 'CC-BY-4.0',
      issue: 'Varia',
    });
    const project = readYaml<{ project: Record<string, unknown> }>(myst).project;
    expect(project.date).toBe('2025-03-20');
    expect(project.license).toBe('CC-BY-4.0');
    expect(project.venue).toEqual({ title: 'Varia' });
    const meta = readYaml<{ project: { exports: { article_url?: string; forthcoming?: boolean }[] } }>(path.join(workdir, 'meta-jdh.yml'));
    expect(meta.project.exports[0].article_url).toBe(articleUrl('6ig87tC5GKjQ'));
    expect(meta.project.exports[0].forthcoming).toBe(false);
  });

  test('not yet public: no date, licence from the copyright cell', async () => {
    const { root, workdir } = setup();
    fs.writeFileSync(
      path.join(workdir, 'article.md'),
      '---\nparts:\n  copyright: "© HEP-VD. … the [Creative Commons Attribution License CC-BY-NC-ND](https://creativecommons.org/licenses/by-nc-nd/4.0/)"\n---\n\nText\n',
    );
    const result = await setJdhArticleMetadata({
      cwd: workdir,
      projectRoot: root,
      dryRun: false,
      fetch: async () => new Response('{"detail":"Authentication credentials were not provided."}', { status: 403 }),
    });
    expect(result).toMatchObject({ date: null, license: 'CC-BY-NC-ND-4.0', issue: null });
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
    expect(result).toEqual({ doi: null, url: articleUrl('6ig87tC5GKjQ'), date: null, license: null, issue: null });
    expect(readYaml<{ project: Record<string, unknown> }>(myst).project.doi).toBeUndefined();
  });
});

describe('API field helpers (JDH-041)', () => {
  test('licenseFromCopyrightType', () => {
    expect(licenseFromCopyrightType('CC_BY')).toBe('CC-BY-4.0');
    expect(licenseFromCopyrightType('CC_BY_NC_ND')).toBe('CC-BY-NC-ND-4.0');
    expect(licenseFromCopyrightType('ALL_RIGHTS_RESERVED')).toBeNull();
    expect(licenseFromCopyrightType(undefined)).toBeNull();
  });

  test('licenseFromCopyrightText', () => {
    expect(licenseFromCopyrightText('[License CC-BY](https://creativecommons.org/licenses/by/4.0/)')).toBe('CC-BY-4.0');
    expect(licenseFromCopyrightText('under the terms of the Creative Commons Attribution License CC-BY-NC-ND')).toBe('CC-BY-NC-ND-4.0');
    expect(licenseFromCopyrightText('All rights reserved')).toBeNull();
  });

  test('dateFromPublicationDate keeps the day as published', () => {
    expect(dateFromPublicationDate('2025-07-24T10:07:42+02:00')).toBe('2025-07-24');
    expect(dateFromPublicationDate(null)).toBeNull();
  });
});
