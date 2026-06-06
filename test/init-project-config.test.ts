import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { fileExists } from '../src/engine/context.js';
import { META_JDH_FILE } from '../src/init/bundled-assets.js';
import {
  SPA_PREVIEW_TEMPLATE,
  buildInitMystYaml,
  findExistingProjectConfig,
  initProjectConfig,
} from '../src/init/project-config.js';
import { normalizeGithubUrl } from '../src/steps/shared/git.js';

describe('init project config', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fileExists(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('buildInitMystYaml includes extends, id, github, and spa-preview site template', () => {
    const yaml = buildInitMystYaml({
      projectId: 'test-uuid',
      github: 'https://github.com/jdh-observer/BHmHNQKJaSWT',
    });
    expect(yaml).toContain('extends:');
    expect(yaml).toContain(META_JDH_FILE);
    expect(yaml).toContain('id: test-uuid');
    expect(yaml).toContain('github: https://github.com/jdh-observer/BHmHNQKJaSWT');
    expect(yaml).toContain(`template: ${SPA_PREVIEW_TEMPLATE}`);
  });

  test('initProjectConfig creates myst.yml and bundled meta-jdh.yml', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-init-'));

    const result = initProjectConfig(tmpDir);
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;

    expect(fileExists(result.mystPath)).toBe(true);
    expect(fileExists(result.metaJdhPath)).toBe(true);

    const myst = fs.readFileSync(result.mystPath, 'utf8');
    expect(myst).toMatch(/id: [0-9a-f-]{36}/);
    expect(myst).toContain(`extends:\n  - ${META_JDH_FILE}`);
    expect(myst).toContain(SPA_PREVIEW_TEMPLATE);

    const meta = fs.readFileSync(result.metaJdhPath, 'utf8');
    expect(meta).toContain('license: CC-BY-NC-ND-4.0');
    expect(meta).toContain('exports:');
    expect(meta).toContain('../../jdh-typst-template');

    expect(result.projectId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('initProjectConfig creates target directory when missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-init-nested-'));
    const nested = path.join(tmpDir, 'my-article');

    const result = initProjectConfig(nested);
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;

    expect(fileExists(nested)).toBe(true);
    expect(fileExists(result.mystPath)).toBe(true);
    expect(fileExists(result.metaJdhPath)).toBe(true);
  });

  test('initProjectConfig reports already initialized when myst.yml exists', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-init-existing-'));
    fs.writeFileSync(path.join(tmpDir, 'myst.yml'), 'version: 1\n');

    const result = initProjectConfig(tmpDir);
    expect(result.status).toBe('already-initialized');
    if (result.status !== 'already-initialized') return;
    expect(result.existing).toBe('myst.yml');
  });

  test('initProjectConfig reports already initialized when curvenote.yml exists', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-init-legacy-'));
    fs.writeFileSync(path.join(tmpDir, 'curvenote.yml'), 'version: 1\n');

    expect(findExistingProjectConfig(tmpDir)).toBe('curvenote.yml');
    const result = initProjectConfig(tmpDir);
    expect(result.status).toBe('already-initialized');
  });

  test('normalizeGithubUrl handles ssh and https remotes', () => {
    expect(normalizeGithubUrl('git@github.com:org/repo.git')).toBe('https://github.com/org/repo');
    expect(normalizeGithubUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo');
  });
});
