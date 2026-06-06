import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'bun:test';
import { fileExists } from '../src/engine/context.js';

const ARTICLE_REPO = path.resolve(import.meta.dir, '../../BHmHNQKJaSWT');
const CLI = path.resolve(import.meta.dir, '../dist/jdh-cli.cjs');
const TYPST_TEMPLATE = path.resolve(ARTICLE_REPO, '../jdh-typst-template');
const WORKDIR = path.join(ARTICLE_REPO, '_improved');
const PDF_PATH = path.join(WORKDIR, 'article.pdf');

function mystAvailable(): boolean {
  return spawnSync('myst', ['--version'], { encoding: 'utf8' }).status === 0;
}

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

describe('build integration (meta-jdh extends)', () => {
  const canRun =
    fileExists(CLI) &&
    fileExists(path.join(ARTICLE_REPO, 'article.md')) &&
    fileExists(TYPST_TEMPLATE) &&
    mystAvailable();

  afterEach(() => {
    if (fileExists(WORKDIR)) {
      runCli(['clean'], ARTICLE_REPO);
    }
  });

  test.skipIf(!canRun)(
    'myst build --pdf succeeds when license and exports live only in meta-jdh.yml',
    () => {
      runCli(['clean'], ARTICLE_REPO);

      const improve = runCli(
        ['article.md', '--project-root', '.', '--workdir', '_improved', '--no-ror-lookup'],
        ARTICLE_REPO,
      );
      expect(improve.status).toBe(0);

      const myst = fs.readFileSync(path.join(WORKDIR, 'myst.yml'), 'utf8');
      const meta = fs.readFileSync(path.join(WORKDIR, 'meta-jdh.yml'), 'utf8');

      expect(myst).toContain('extends:');
      expect(myst).toContain('meta-jdh.yml');
      expect(myst).not.toContain('exports:');
      expect(meta).toContain('exports:');
      expect(meta).toContain('license: CC-BY-NC-ND-4.0');

      const build = runCli(['build'], ARTICLE_REPO);
      expect(build.status).toBe(0);
      expect(build.stderr + build.stdout).toMatch(/article\.pdf|Performing exports/i);

      expect(fileExists(PDF_PATH)).toBe(true);
      expect(fs.statSync(PDF_PATH).size).toBeGreaterThan(0);
    },
    120_000,
  );
});
