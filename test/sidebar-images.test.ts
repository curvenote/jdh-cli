import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { buildRunContext, parseConvertOptions } from '../src/engine/context.js';
import {
  installSuppliedSidebarImages,
  pointExportsAtSidebarImages,
  readImageSource,
} from '../src/engine/sidebar-images.js';
import { prepareWorkdir } from '../src/engine/workdir.js';
import { isSvg } from '../src/steps/shared/image-format.js';
import { readYaml } from '../src/steps/shared/yaml-doc.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ');

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function mkTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-sidebar-'));
  return tmpDir;
}

function write(dir: string, name: string, bytes: Buffer | string): string {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}

test('isSvg', () => {
  expect(isSvg(SVG)).toBe(true);
  expect(isSvg(Buffer.from('﻿<!-- x --><svg width="1"/>'))).toBe(true);
  expect(isSvg(Buffer.from('<html><svg></svg></html>'))).toBe(false);
  expect(isSvg(PNG)).toBe(false);
});

describe('readImageSource', () => {
  test('reads a local file', async () => {
    const file = write(mkTmp(), 'qr.png', PNG);
    expect(await readImageSource(file)).toEqual(PNG);
  });

  test('fails clearly for a missing file', async () => {
    await expect(readImageSource('/nonexistent/qr.png')).rejects.toThrow('file not found: /nonexistent/qr.png');
  });

  test('downloads a URL', async () => {
    const urls: string[] = [];
    const bytes = await readImageSource('https://example.org/qr.png', async (url) => {
      urls.push(url);
      return new Response(PNG);
    });
    expect(urls).toEqual(['https://example.org/qr.png']);
    expect(bytes).toEqual(PNG);
  });

  test('fails clearly when the download fails', async () => {
    await expect(readImageSource('https://example.org/x', async () => new Response('', { status: 404 }))).rejects.toThrow(
      'could not download https://example.org/x: HTTP 404',
    );
    await expect(
      readImageSource('https://example.org/x', async () => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toThrow('could not download https://example.org/x: fetch failed');
  });
});

describe('installSuppliedSidebarImages', () => {
  test('names each file by its bytes and returns the export paths', async () => {
    const dir = mkTmp();
    const qr = write(dir, 'in/qr.jpeg', JPEG);
    const supplied = await installSuppliedSidebarImages(
      path.join(dir, 'wd'),
      { qrCode: qr, fingerprint: 'https://example.org/fp' },
      false,
      async () => new Response(SVG),
    );
    expect([...supplied]).toEqual([
      ['qr_code', './generated/qr.jpg'],
      ['fingerprint', './generated/fingerprint.svg'],
    ]);
    expect(fs.readFileSync(path.join(dir, 'wd/generated/qr.jpg'))).toEqual(JPEG);
    expect(fs.readFileSync(path.join(dir, 'wd/generated/fingerprint.svg'))).toEqual(SVG);
  });

  test('replaces the copy from the article repo', async () => {
    const dir = mkTmp();
    write(dir, 'wd/generated/qr.png', PNG);
    await installSuppliedSidebarImages(path.join(dir, 'wd'), { qrCode: write(dir, 'qr.jpg', JPEG) }, false);
    expect(fs.readdirSync(path.join(dir, 'wd/generated'))).toEqual(['qr.jpg']);
  });

  test('rejects anything that is not PNG, JPEG, GIF or SVG', async () => {
    const dir = mkTmp();
    const webp = write(dir, 'fp.png', WEBP);
    await expect(installSuppliedSidebarImages(path.join(dir, 'wd'), { fingerprint: webp }, false)).rejects.toThrow(
      `--fingerprint: ${webp} is not a PNG, JPEG, GIF or SVG image`,
    );
  });

  test('dry run validates but writes nothing', async () => {
    const dir = mkTmp();
    const supplied = await installSuppliedSidebarImages(path.join(dir, 'wd'), { qrCode: write(dir, 'qr.png', PNG) }, true);
    expect(supplied.get('qr_code')).toBe('./generated/qr.png');
    expect(fs.existsSync(path.join(dir, 'wd'))).toBe(false);
  });
});

test('pointExportsAtSidebarImages sets paths on templated exports only', () => {
  const cfg = write(
    mkTmp(),
    'meta-jdh.yml',
    'version: 1\nproject:\n  exports:\n    - format: pdf\n      template: ../t\n      qr_code: ./generated/qr.png\n    - format: docx\n',
  );
  pointExportsAtSidebarImages(cfg, new Map([['qr_code', './generated/qr.jpg']]));
  expect(readYaml<{ project: { exports: unknown[] } }>(cfg).project.exports).toEqual([
    { format: 'pdf', template: '../t', qr_code: './generated/qr.jpg' },
    { format: 'docx' },
  ]);
});

describe('prepareWorkdir sidebar images', () => {
  async function prepare(root: string, flags: { qrCode?: string; fingerprint?: string } = {}): Promise<string> {
    const input = write(root, 'article.md', '# A\n');
    const ctx = buildRunContext('jupytext', input, parseConvertOptions({ projectRoot: root, ...flags }));
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await prepareWorkdir(ctx);
      return log.mock.calls.map((c) => String(c[0])).join('\n');
    } finally {
      log.mockRestore();
    }
  }

  test('flag, then repo image, then a placeholder with a warning', async () => {
    const root = mkTmp();
    write(root, 'generated/fingerprint.png', PNG);
    const out = await prepare(root, { qrCode: write(root, 'my-qr.jpg', JPEG) });

    expect(out).toContain('QR code: ./generated/qr.jpg (from --qr-code)');
    expect(out).toContain('Fingerprint: generated/fingerprint.png from the article repo');
    expect(out).not.toContain('PLACEHOLDER');
    const wd = path.join(root, '_improved');
    expect(fs.readdirSync(path.join(wd, 'generated')).sort()).toEqual(['fingerprint.png', 'qr.jpg']);
    const meta = readYaml<{ project: { exports: Record<string, string>[] } }>(path.join(wd, 'meta-jdh.yml'));
    expect(meta.project.exports[0].qr_code).toBe('./generated/qr.jpg');
    expect(meta.project.exports[0].fingerprint).toBe('./generated/fingerprint.png');
  });

  test('without flags or repo images, placeholders and a loud warning', async () => {
    const out = await prepare(mkTmp());
    expect(out).toContain('Warning: no QR code given (--qr-code <path|url>)');
    expect(out).toContain('the PDF will show a PLACEHOLDER fingerprint');
  });
});
