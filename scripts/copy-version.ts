import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
writeFileSync(
  join(root, 'src/version.ts'),
  `const version = '${pkg.version}';\nexport default version;\n`,
);
