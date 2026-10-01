/** Image format Typst can read, from the file's magic bytes; null for anything else (e.g. WebP). */
export function imageFormat(bytes: Buffer): 'png' | 'jpg' | 'gif' | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  return null;
}

/** True for SVG text (optionally after a BOM, XML declaration, comments or doctype). */
export function isSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
  return /^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head);
}
