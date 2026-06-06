import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { fileExists } from '../src/engine/context.js';
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

  test('buildInitMystYaml includes id, github, and spa-preview site template', () => {
    const yaml = buildInitMystYaml({
      projectId: 'test-uuid',
      github: 'https://github.com/jdh-observer/BHmHNQKJaSWT',
    });
    expect(yaml).toContain('id: test-uuid');
    expect(yaml).toContain('github: https://github.com/jdh-observer/BHmHNQKJaSWT');
    expect(yaml).toContain(`template: ${SPA_PREVIEW_TEMPLATE}`);
  });

  test('initProjectConfig creates myst.yml in a folder without existing config', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-init-'));

    const result = initProjectConfig(tmpDir);
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;

    expect(fileExists(result.path)).toBe(true);
    const content = fs.readFileSync(result.path, 'utf8');
    expect(content).toMatch(/id: [0-9a-f-]{36}/);
    expect(content).toContain(SPA_PREVIEW_TEMPLATE);
    expect(result.projectId).toMatch(/^[0-9a-f-]{36}$/);
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
