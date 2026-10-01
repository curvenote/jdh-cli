import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { parseDocument } from 'yaml';
import { completeConfig, DEFAULT_SITE_TEMPLATE } from '../src/steps/common/init-myst-config.js';
import { extractJupytextFrontmatter } from '../src/steps/jupytext/extract-jupytext-frontmatter.js';
import { listBundledPluginRelPaths } from '../src/init/bundled-plugins.js';
import { readYaml } from '../src/steps/shared/yaml-doc.js';

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

test('completeConfig keeps hand edits and fills in only what the pipeline needs (JDH-012)', () => {
  const doc = parseDocument(
    [
      '# my notes',
      'project:',
      '  id: keep-me',
      '  title: My edited title',
      '  plugins:',
      '    - plugins/my-plugin.mjs',
      '  exports:',
      '    - format: pdf',
      '      template: ../t',
      '      first_page: 3',
      'site:',
      '  template: my-theme',
      '',
    ].join('\n'),
  );
  const added: string[] = [];
  completeConfig(doc, 'keep-me', true, added);
  const out = doc.toJS();

  expect(doc.toString()).toStartWith('# my notes');
  expect(out.version).toBe(1);
  expect(out.extends).toEqual(['meta-jdh.yml']);
  expect(out.project.title).toBe('My edited title');
  expect(out.project.exports[0].first_page).toBe(3);
  expect(out.site.template).toBe('my-theme');
  expect(out.project.plugins).toEqual(['plugins/my-plugin.mjs', ...listBundledPluginRelPaths()]);
  expect(out.project.toc).toEqual([{ file: 'article.md' }]);
  expect(added).toContain('toc');
  expect(added.some((a) => a.startsWith('site.template'))).toBe(false);
});

test('completeConfig on a bare file adds the defaults', () => {
  const doc = parseDocument('project: {}\n');
  completeConfig(doc, 'new-id', false, []);
  const out = doc.toJS();
  expect(out.project.id).toBe('new-id');
  expect(out.extends).toBeUndefined();
  expect(out.site.template).toBe(DEFAULT_SITE_TEMPLATE);
});

test('front matter from the notebook does not overwrite keys set in the repo myst.yml', async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-repo-myst-'));
  fs.writeFileSync(
    path.join(tmpDir, 'article.md'),
    [
      '<!-- #region tags=["title"] -->',
      '# Title from the notebook',
      '<!-- #endregion -->',
      '<!-- #region tags=["keywords"] -->',
      '**Keywords:** a; b',
      '<!-- #endregion -->',
      '<!-- #region tags=["contributor"] -->',
      '### Jane Doe',
      'Somewhere',
      '<!-- #endregion -->',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'myst.yml'),
    'version: 1\nproject:\n  id: x\n  keywords:\n    - history of education\n    - reflexivity\n',
  );
  const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
  let out = '';
  write.mockImplementation(((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write);
  try {
    await extractJupytextFrontmatter({ cwd: tmpDir, dryRun: false, orcidLookup: false });
  } finally {
    write.mockRestore();
  }
  const project = readYaml<{ project: Record<string, unknown> }>(path.join(tmpDir, 'myst.yml')).project;
  expect(project.keywords).toEqual(['history of education', 'reflexivity']);
  expect(project.title).toBe('Title from the notebook');
  expect(project.authors).toEqual([{ name: 'Jane Doe', affiliations: ['Somewhere'] }]);
  expect(out).toContain("Kept from the repo's myst.yml: project.keywords");
});
