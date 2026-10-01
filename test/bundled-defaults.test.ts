import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { pointExportsAtTemplate } from '../src/commands/build.js';
import { deployBundledDefaults } from '../src/init/bundled-assets.js';

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function mkTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-defaults-'));
  return tmpDir;
}

describe('deployBundledDefaults', () => {
  test('adds meta-jdh.yml and placeholder images when missing', () => {
    const dir = mkTmp();
    expect(deployBundledDefaults(dir, false)).toBe(3);
    expect(fs.readFileSync(path.join(dir, 'meta-jdh.yml'), 'utf8')).toContain('format: pdf');
    expect(fs.existsSync(path.join(dir, 'generated', 'qr.png'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'generated', 'fingerprint.png'))).toBe(true);
  });

  test('keeps files the article already provides', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'meta-jdh.yml'), 'version: 1\n');
    fs.mkdirSync(path.join(dir, 'generated'));
    fs.writeFileSync(path.join(dir, 'generated', 'qr.png'), 'mine');
    expect(deployBundledDefaults(dir, false)).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'meta-jdh.yml'), 'utf8')).toBe('version: 1\n');
    expect(fs.readFileSync(path.join(dir, 'generated', 'qr.png'), 'utf8')).toBe('mine');
  });
});

describe('pointExportsAtTemplate', () => {
  test('rewrites export templates only', () => {
    const dir = mkTmp();
    const cfg = path.join(dir, 'myst.yml');
    fs.writeFileSync(
      cfg,
      [
        'version: 1',
        'project:',
        '  exports:',
        '    - format: pdf',
        '      template: ../../jdh-typst-template',
        '      output: article.pdf',
        '    - template: other',
        '      format: pdf',
        'site:',
        '  template: book-theme',
        '',
      ].join('\n'),
    );
    expect(pointExportsAtTemplate(cfg, '/abs/jdh-typst-template')).toBe(true);
    const out = fs.readFileSync(cfg, 'utf8');
    expect(out).toContain('      template: /abs/jdh-typst-template\n      output: article.pdf');
    expect(out).toContain('    - template: /abs/jdh-typst-template\n');
    expect(out).toContain('site:\n  template: book-theme');
  });

  test('returns false when there is no config', () => {
    expect(pointExportsAtTemplate('/nonexistent/myst.yml', '/abs')).toBe(false);
  });
});
