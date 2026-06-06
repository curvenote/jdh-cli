import fs from 'node:fs';

export function copyTree(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true, force: true });
}
