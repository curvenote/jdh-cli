import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

copyFileSync(join(root, 'templates', 'meta-jdh.yml'), join(dist, 'meta-jdh.yml'));

function copyPluginsDir(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = join(srcDir, name);
    const destPath = join(destDir, name);
    if (statSync(srcPath).isDirectory()) {
      copyPluginsDir(srcPath, destPath);
    } else if (name.endsWith('.mjs')) {
      copyFileSync(srcPath, destPath);
    }
  }
}

copyPluginsDir(join(root, 'templates', 'plugins'), join(dist, 'plugins'));
