import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

copyFileSync(join(root, 'templates', 'meta-jdh.yml'), join(dist, 'meta-jdh.yml'));

const pluginsSrc = join(root, 'templates', 'plugins');
const pluginsDest = join(dist, 'plugins');
mkdirSync(pluginsDest, { recursive: true });
for (const name of readdirSync(pluginsSrc)) {
  if (!name.endsWith('.mjs')) continue;
  copyFileSync(join(pluginsSrc, name), join(pluginsDest, name));
}
