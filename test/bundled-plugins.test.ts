import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { fileExists } from '../src/engine/context.js';
import {
  deployBundledPlugins,
  listBundledPluginRelPaths,
  resolveBundledPluginsDir,
} from '../src/init/bundled-plugins.js';

describe('bundled plugins', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fileExists(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('lists bundled plugin paths', () => {
    const paths = listBundledPluginRelPaths();
    expect(paths).toContain('plugins/hermeneutics.mjs');
    expect(paths.every((p) => p.startsWith('plugins/'))).toBe(true);
  });

  test('deployBundledPlugins copies plugins into workdir', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-cli-plugins-'));
    const count = deployBundledPlugins(tmpDir, false);

    expect(count).toBeGreaterThan(0);
    const deployed = path.join(tmpDir, 'plugins', 'hermeneutics.mjs');
    expect(fileExists(deployed)).toBe(true);

    const bundled = path.join(resolveBundledPluginsDir(), 'hermeneutics.mjs');
    expect(fs.readFileSync(deployed, 'utf8')).toBe(fs.readFileSync(bundled, 'utf8'));
  });
});
