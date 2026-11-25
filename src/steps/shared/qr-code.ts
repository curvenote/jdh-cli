import QRCode from 'qrcode';
import { PNG } from 'pngjs';

/**
 * QR code image for the PDF sidebar: the article URL as a PNG with the JDH logo
 * in the middle. Port of dev/generate_qrcode.py (Python `qrcode` StyledPilImage).
 */

/** Straight-alpha RGBA pixels, row by row. */
interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface QrOptions {
  /** Pixels per QR module. */
  boxSize?: number;
  /** Quiet zone, in modules. */
  border?: number;
  /** Logo width as a fraction of the image width. */
  logoRatio?: number;
}

const lanczos = (x: number): number => {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

/** Filter taps for one output pixel along an axis, in the way Pillow builds them. */
function taps(outSize: number, inSize: number): { start: number; weights: number[] }[] {
  const scale = inSize / outSize;
  const filterScale = Math.max(scale, 1);
  const support = 3 * filterScale;
  return Array.from({ length: outSize }, (_, i) => {
    const center = (i + 0.5) * scale;
    const start = Math.max(Math.floor(center - support + 0.5), 0);
    const end = Math.min(Math.floor(center + support + 0.5), inSize);
    const weights: number[] = [];
    let total = 0;
    for (let x = start; x < end; x++) {
      const w = lanczos((x - center + 0.5) / filterScale);
      weights.push(w);
      total += w;
    }
    return { start, weights: weights.map((w) => w / total) };
  });
}

const clampByte = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

/** Lanczos resize on premultiplied alpha, like Pillow's `Image.resize(..., LANCZOS)`. */
function resizeLanczos(src: Raster, width: number, height: number): Raster {
  const pre = new Float64Array(src.data.length);
  for (let p = 0; p < src.data.length; p += 4) {
    const a = src.data[p + 3] / 255;
    pre[p] = src.data[p] * a;
    pre[p + 1] = src.data[p + 1] * a;
    pre[p + 2] = src.data[p + 2] * a;
    pre[p + 3] = src.data[p + 3];
  }

  const horizontal = new Float64Array(width * src.height * 4);
  const xTaps = taps(width, src.width);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < width; x++) {
      const { start, weights } = xTaps[x];
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < weights.length; k++)
          sum += pre[(y * src.width + start + k) * 4 + c] * weights[k];
        horizontal[(y * width + x) * 4 + c] = clampByte(sum);
      }
    }
  }

  const out = new Uint8Array(width * height * 4);
  const yTaps = taps(height, src.height);
  for (let y = 0; y < height; y++) {
    const { start, weights } = yTaps[y];
    for (let x = 0; x < width; x++) {
      const px = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < weights.length; k++)
          sum += horizontal[((start + k) * width + x) * 4 + c] * weights[k];
        px[c] = clampByte(sum);
      }
      const a = px[3] / 255;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = a > 0 ? clampByte(px[c] / a) : 0;
      out[o + 3] = px[3];
    }
  }
  return { width, height, data: out };
}

/** Logo centred on a transparent square, so the square resize doesn't stretch it. */
function squareLogo(logo: Raster): Raster {
  const side = Math.max(logo.width, logo.height);
  const data = new Uint8Array(side * side * 4);
  const left = Math.floor((side - logo.width) / 2);
  const top = Math.floor((side - logo.height) / 2);
  for (let y = 0; y < logo.height; y++) {
    data.set(
      logo.data.subarray(y * logo.width * 4, (y + 1) * logo.width * 4),
      ((top + y) * side + left) * 4,
    );
  }
  return { width: side, height: side, data };
}

/** Draw `top` over the opaque `base` at (x0, y0). */
function alphaComposite(base: Raster, top: Raster, x0: number, y0: number): void {
  for (let y = 0; y < top.height; y++) {
    for (let x = 0; x < top.width; x++) {
      const s = (y * top.width + x) * 4;
      const d = ((y0 + y) * base.width + x0 + x) * 4;
      const a = top.data[s + 3] / 255;
      for (let c = 0; c < 3; c++)
        base.data[d + c] = clampByte(top.data[s + c] * a + base.data[d + c] * (1 - a));
    }
  }
}

function decodePng(bytes: Buffer): Raster {
  const png = PNG.sync.read(bytes);
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * PNG of a QR code for `url` (highest error correction, so the logo can cover
 * the middle) with `logoPng` centred on it, snapped to the module grid.
 */
export function renderQrPng(url: string, logoPng: Buffer, options: QrOptions = {}): Buffer {
  const { boxSize = 10, border = 4, logoRatio = 0.35 } = options;
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = (modules.size + border * 2) * boxSize;

  const img: Raster = {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4).fill(255),
  };
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      for (let y = 0; y < boxSize; y++) {
        for (let x = 0; x < boxSize; x++) {
          const o = (((row + border) * boxSize + y) * size + (col + border) * boxSize + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
        }
      }
    }
  }

  const logoWidthIsh = Math.trunc(size * logoRatio);
  const offset =
    Math.trunc((Math.trunc(size / 2) - Math.trunc(logoWidthIsh / 2)) / boxSize) * boxSize;
  const logoWidth = size - offset * 2;
  alphaComposite(
    img,
    resizeLanczos(squareLogo(decodePng(logoPng)), logoWidth, logoWidth),
    offset,
    offset,
  );

  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(img.data);
  return PNG.sync.write(png);
}
