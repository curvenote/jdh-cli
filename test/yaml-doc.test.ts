import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter,
  toYaml,
  updateYamlFile,
} from '../src/steps/shared/yaml-doc.js';

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

describe('updateYamlFile', () => {
  test('edits values while keeping comments and key order', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-yaml-'));
    const file = path.join(tmpDir, 'myst.yml');
    fs.writeFileSync(file, '# keep me\nversion: 1\nproject:\n  id: x # inline\n  title: Old\n');
    expect(updateYamlFile(file, (doc) => doc.setIn(['project', 'title'], 'New: with colon'))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '# keep me\nversion: 1\nproject:\n  id: x # inline\n  title: "New: with colon"\n',
    );
  });

  test('reports no change and leaves the file alone', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-yaml-'));
    const file = path.join(tmpDir, 'myst.yml');
    fs.writeFileSync(file, 'project:\n  id: x\n');
    expect(updateYamlFile(file, (doc) => doc.setIn(['project', 'id'], 'x'))).toBe(false);
  });
});

describe('markdown frontmatter', () => {
  test('round-trips frontmatter and body', () => {
    const md = '---\njupyter:\n  kernelspec:\n    name: python3\n---\n\n# Title\n';
    const parsed = parseMarkdownFrontmatter(md);
    parsed.doc.setIn(['parts', 'abstract'], 'Line one.\nLine two.');
    expect(stringifyMarkdownFrontmatter(parsed)).toBe(
      '---\njupyter:\n  kernelspec:\n    name: python3\nparts:\n  abstract: |-\n    Line one.\n    Line two.\n---\n\n# Title\n',
    );
  });

  test('adds frontmatter to a file that has none', () => {
    const parsed = parseMarkdownFrontmatter('# Title\n');
    parsed.doc.setIn(['parts', 'abstract'], 'Short.');
    expect(stringifyMarkdownFrontmatter(parsed)).toBe('---\nparts:\n  abstract: Short.\n---\n# Title\n');
  });
});

test('toYaml writes a leading comment', () => {
  expect(toYaml({ version: 1 }, 'See docs')).toBe('# See docs\n\nversion: 1\n');
});
