import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fileExists } from '../src/engine/context.js';
import { resolveWorkdirAbs } from '../src/engine/paths.js';

const ARTICLE_REPO = path.resolve(import.meta.dir, '../../BHmHNQKJaSWT');
const CLI = path.resolve(import.meta.dir, '../dist/jdh-cli.cjs');

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(['node', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe('jupytext pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    if (!fileExists(CLI)) {
      throw new Error(`Build jdh-cli first: bun run build (missing ${CLI})`);
    }
    if (!fileExists(path.join(ARTICLE_REPO, 'article.md'))) {
      throw new Error(`Article fixture not found: ${ARTICLE_REPO}`);
    }
  });

  afterEach(() => {
    if (tmpDir && fileExists(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('improve produces myst.yml, article.md, and references.bib', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-cli-test-'));
    fs.copyFileSync(path.join(ARTICLE_REPO, 'article.md'), path.join(tmpDir, 'article.md'));
    fs.copyFileSync(path.join(ARTICLE_REPO, 'article.ipynb'), path.join(tmpDir, 'article.ipynb'));
    for (const dep of ['metadata.yml', 'curvenote.yml', 'plugins', 'data', 'generated']) {
      const src = path.join(ARTICLE_REPO, dep);
      const dest = path.join(tmpDir, dep);
      if (!fileExists(src)) continue;
      fs.cpSync(src, dest, { recursive: true });
    }

    const workdir = '_improved';
    const res = runCli(
      ['article.md', '--project-root', '.', '--workdir', workdir, '--no-ror-lookup'],
      tmpDir,
    );

    expect(res.status).toBe(0);

    const improved = path.join(tmpDir, workdir);
    expect(fileExists(path.join(improved, 'myst.yml'))).toBe(true);
    expect(fileExists(path.join(improved, 'article.md'))).toBe(true);
    expect(fileExists(path.join(improved, 'references.bib'))).toBe(true);

    const myst = fs.readFileSync(path.join(improved, 'myst.yml'), 'utf8');
    expect(myst).toContain('license: CC-BY-NC-ND-4.0');
    expect(myst).toContain('plugins/hermeneutics.mjs');

    const article = fs.readFileSync(path.join(improved, 'article.md'), 'utf8');
    expect(article).toMatch(/^#\s+/m);
  });

  test('clean removes workdir', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-cli-clean-'));
    const workdirAbs = path.join(tmpDir, '_improved');
    fs.mkdirSync(workdirAbs, { recursive: true });
    fs.writeFileSync(path.join(workdirAbs, 'article.md'), '# test\n');

    const res = runCli(['clean', '--project-root', tmpDir], tmpDir);
    expect(res.status).toBe(0);
    expect(fileExists(workdirAbs)).toBe(false);
  });
});

describe('resolveWorkdirAbs', () => {
  test('rejects workdir outside project root', () => {
    expect(() => resolveWorkdirAbs('/project', '../outside')).toThrow(/outside project root/);
  });
});
