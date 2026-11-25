/**
 * Draw an article's fingerprint from its notebook, with no browser and no network.
 *
 * A port of the JDH website's own three pieces: `src/logic/parseNotebook.jsx` reads the
 * per-cell counts, `src/components/Article/ArticleFingerprint.jsx` lays them out on a
 * circle, and `ArticleFingerprintCellGraphics.jsx` draws each one. Checked against the
 * live viewer's output for 6ig87tC5GKjQ: all 178 cells match to 3e-14 px.
 *
 * The site's colours live in its stylesheet rather than in those files, so the palette
 * below was read back off a rendered fingerprint.
 *
 * Self-contained on purpose — no dependencies. The only thing borrowed from d3 is
 * `scalePow`, which is six lines.
 *
 * See AGENTS.md in this folder for the upstream commits this was taken from, what was
 * left out, and how to check it against the website again.
 */

/** One notebook cell, reduced to what the drawing needs. */
export interface FingerprintCell {
  type: string;
  countChars: number;
  countRefs: number;
  isHeading: boolean;
  isHermeneutic: boolean;
}

export interface FingerprintData {
  cells: FingerprintCell[];
  extentChars: [number, number];
  extentRefs: [number, number];
}

interface NotebookCell {
  cell_type?: string;
  source?: string[] | string;
  metadata?: { tags?: string[] };
}

const DATACITE = /data-cite=['"][^'"]+['"]/g;
const HEADING = /^\s*#+\s/;

/** Port of `parseNotebook.jsx`: per-cell counts and the extents the scales need. */
export function parseNotebook(notebook: { cells?: NotebookCell[] }): FingerprintData {
  const cells: FingerprintCell[] = [];
  let extentChars: [number, number] = [Infinity, -Infinity];
  let extentRefs: [number, number] = [Infinity, -Infinity];

  for (const cell of notebook.cells ?? []) {
    const tags = cell.metadata?.tags ?? [];
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
    const countChars = source.length;
    const countRefs = (source.match(DATACITE) ?? []).length;

    extentChars = [Math.min(extentChars[0], countChars), Math.max(extentChars[1], countChars)];
    extentRefs = [Math.min(extentRefs[0], countRefs), Math.max(extentRefs[1], countRefs)];

    cells.push({
      type: cell.cell_type ?? 'markdown',
      countChars,
      countRefs,
      isHeading: cell.cell_type === 'markdown' && HEADING.test(source),
      // A hidden cell is drawn, but never as hermeneutics: parseNotebook stops
      // reading tags once it has seen `hidden`.
      isHermeneutic:
        !tags.includes('hidden') &&
        tags.some((t) => t === 'hermeneutics' || t === 'hermeneutics-step'),
    });
  }
  return { cells, extentChars, extentRefs };
}

/** d3's `scalePow`: raise value and domain to `exponent`, then interpolate into `range`. */
function scalePow(
  x: number,
  domain: readonly [number, number],
  range: readonly [number, number],
  exponent: number,
): number {
  const t = (v: number) => Math.sign(v) * Math.abs(v) ** exponent;
  const [d0, d1] = [t(domain[0]), t(domain[1])];
  const n = d1 === d0 ? 0 : (t(x) - d0) / (d1 - d0);
  return range[0] + n * (range[1] - range[0]);
}

/** Colours read back off a fingerprint the website rendered. */
const INK = {
  narrativeLine: 'rgb(173, 181, 189)',
  narrativeDot: 'rgb(73, 80, 87)',
  hermeneuticsLine: 'rgb(81, 246, 224)',
  codeLine: 'rgb(94, 43, 255)',
  heading: 'rgb(34, 35, 34)',
  hermeneuticsRing: 'rgb(222, 226, 230)',
} as const;

function lineInk(cell: FingerprintCell): string {
  if (cell.type === 'code') return INK.codeLine;
  return cell.isHermeneutic ? INK.hermeneuticsLine : INK.narrativeLine;
}

/** `cx`/`cy`/`r`/fill/stroke for the dot that marks the cell itself. */
function cellDot(cell: FingerprintCell): { fill: string; stroke: string } {
  if (cell.type === 'code') return { fill: INK.codeLine, stroke: 'none' };
  if (cell.isHermeneutic) return { fill: INK.hermeneuticsLine, stroke: INK.hermeneuticsRing };
  if (cell.isHeading) return { fill: 'none', stroke: INK.heading };
  return { fill: INK.narrativeDot, stroke: 'none' };
}

function originInk(cell: FingerprintCell): string {
  if (cell.type === 'code') return INK.codeLine;
  if (cell.isHeading || cell.isHermeneutic) return INK.heading;
  return INK.narrativeDot;
}

const n = (v: number) => (Math.round(v * 1e6) / 1e6).toString();

export interface DrawOptions {
  /** Side of the square SVG, in user units. The site uses 100 in listings. */
  size?: number;
  /** Space kept for the text elements the site draws outside the ring. */
  margin?: number;
}

/**
 * Render the fingerprint as a standalone SVG string.
 *
 * Geometry straight from `ArticleFingerprint.jsx`: the cells are spaced evenly round a
 * circle of `radius`, each drawn as a line from the ring outward by a power-scaled
 * character count — inward when the cell is hermeneutics, which is what gives the
 * fingerprint its two layers.
 */
export function drawFingerprint(data: FingerprintData, options: DrawOptions = {}): string {
  const { size = 616, margin = 20 } = options;
  const { cells, extentChars, extentRefs } = data;
  if (!cells.length) throw new Error('the notebook has no cells to draw');

  const compactScale = Math.max(0.45, Math.min(1, size / 220));
  const markerScale = Math.max(0.35, Math.min(1, size / 260));
  const lineStrokeWidth = Math.max(0.35, 1.2 * compactScale);
  const circleStrokeWidth = Math.max(0.3, 0.75 * markerScale);
  const originDotRadius = Math.max(0.25, 0.8 * markerScale);
  const headingDotRadius = Math.max(1.4, 4.5 * markerScale);
  const circleRadius = Math.max(0.8, 2.2 * markerScale);
  const refsOffset = 4 * markerScale;
  const radius = ((size / 2 - margin) * 2) / 3;
  const maxNumCharsRadius = radius / 2;
  const minNumRefsRadius = Math.max(0.5, 1.3 * markerScale);
  const maxNumRefsRadius = Math.max(1.6, 4.2 * markerScale);
  const angleD = (Math.PI * 2) / (cells.length + 1);

  const parts: string[] = [];
  cells.forEach((cell, i) => {
    const theta = i * angleD - Math.PI / 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const numChars = scalePow(cell.countChars, extentChars, [0, maxNumCharsRadius], 0.25);
    const offset = cell.isHermeneutic ? -numChars : numChars;

    const ox = cos * radius;
    const oy = sin * radius;
    const cx = cos * (offset + radius);
    const cy = sin * (offset + radius);
    const dot = cellDot(cell);

    const g = [
      `<line x1="${n(ox)}" y1="${n(oy)}" x2="${n(cx)}" y2="${n(cy)}" ` +
        `stroke="${lineInk(cell)}" stroke-width="${n(lineStrokeWidth)}"/>`,
      `<circle cx="${n(ox)}" cy="${n(oy)}" r="${n(originDotRadius)}" fill="${originInk(cell)}"/>`,
    ];
    if (cell.isHeading) {
      g.push(
        `<circle cx="${n(ox)}" cy="${n(oy)}" r="${n(headingDotRadius)}" fill="none" ` +
          `stroke="${INK.heading}" stroke-width="${n(circleStrokeWidth)}"/>`,
      );
    }
    if (cell.countRefs) {
      const refsRadius = scalePow(
        cell.countRefs,
        extentRefs,
        [minNumRefsRadius, maxNumRefsRadius],
        1,
      );
      const at = offset + radius + refsRadius + refsOffset;
      g.push(
        `<circle cx="${n(cos * at)}" cy="${n(sin * at)}" r="${n(refsRadius)}" ` +
          `fill="${INK.narrativeDot}"/>`,
      );
    }
    g.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(circleRadius)}" fill="${dot.fill}" ` +
        `stroke="${dot.stroke}" stroke-width="${n(circleStrokeWidth)}"/>`,
    );
    parts.push(`<g>${g.join('')}</g>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(size)}" height="${n(size)}" ` +
    `viewBox="0 0 ${n(size)} ${n(size)}">` +
    `<g transform="translate(${n(size / 2)}, ${n(size / 2)})">${parts.join('')}</g>` +
    `</svg>\n`
  );
}

/** Read `article.ipynb` and draw its fingerprint. */
export function fingerprintFromNotebook(json: string, options: DrawOptions = {}): string {
  return drawFingerprint(parseNotebook(JSON.parse(json)), options);
}
