import fs from 'node:fs';

/**
 * Read tagged cells (figures, tables, media) from a JDH notebook: their kind,
 * captions from every place JDH authors put them, and their displayable outputs.
 *
 * The Jupytext markdown keeps cell sources and tags but no outputs; this is the
 * notebook side of the markdown ↔ notebook correspondence (matched by tag).
 */

export type CellKind = 'figure' | 'table' | 'video' | 'sound';

export interface CellCaptions {
  /** `metadata={"jdh": …}` literal written in the cell's code. */
  code: string | null;
  /** Cell metadata `jdh.object.source` (Jupytext also writes it on the fence line). */
  cell: string | null;
  /** Output metadata `jdh.object.source`, from the last execution. May be stale. */
  output: string | null;
}

export interface CellOutput {
  mime: string;
  data: string;
  metadata: Record<string, unknown>;
}

export interface TaggedCell {
  index: number;
  kind: CellKind;
  /** The tag that identified the kind, e.g. `figure-1-*` or `figure-cartoon-*`. */
  tag: string;
  tags: string[];
  source: string;
  captions: CellCaptions;
  /** One chosen representation per displayable output; stream and error outputs dropped. */
  outputs: CellOutput[];
  /** Number of stream (log) and error outputs left out. */
  dropped: number;
}

interface RawOutput {
  output_type?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface RawCell {
  cell_type?: string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: RawOutput[];
}

export interface RawNotebook {
  cells?: RawCell[];
}

const KIND_TAG = /^(fig(?:ure)?|table|video|sound|audio)(?=$|[-_:\d])/i;

/** Preferred representation for the PDF, most preferred first. */
export const MIME_PRIORITY: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/gif',
  'text/markdown',
  'text/html',
  'application/vnd.plotly.v1+json',
  'text/latex',
  'text/plain',
];

function joinText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('');
  return typeof value === 'string' ? value : '';
}

/** Kind and identifying tag from a cell's tags, or null for untagged cells. */
export function kindFromTags(tags: readonly string[]): { kind: CellKind; tag: string } | null {
  for (const tag of tags) {
    const m = tag.match(KIND_TAG);
    if (!m) continue;
    const word = m[1].toLowerCase();
    const kind: CellKind =
      word.startsWith('fig') ? 'figure' : word === 'audio' ? 'sound' : (word as CellKind);
    return { kind, tag };
  }
  return null;
}

/**
 * MyST label for a figure tag: `figure-1-*`, `figure_1` → `fig:1`;
 * `figure-cartoon-*` → `fig:cartoon`; `fig:…` unchanged.
 */
export function figureLabelFromTag(tag: string): string {
  if (/^fig:/i.test(tag)) return tag;
  const slug = tag
    .replace(/^fig(?:ure)?[-_]?/i, '')
    .replace(/[-_]?\*$/, '')
    .replace(/^[-_]+|[-_]+$/g, '');
  return `fig:${slug}`;
}

/** Caption text from a `jdh` metadata object (`jdh.object.source`). */
export function captionFromJdh(jdh: unknown): string | null {
  if (!jdh || typeof jdh !== 'object') return null;
  const object = (jdh as { object?: { source?: unknown } }).object;
  const text = joinText(object?.source).trim();
  return text || null;
}

/** Caption from a `metadata={"jdh": …}` literal in the code (first source string). */
export function captionFromCode(code: string): string | null {
  const match = code.match(/"source"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\"/g, '"') : null;
}

/** Parse `key={…}` JSON written by Jupytext on a markdown fence line, or null. */
export function parseFenceMetadata(fenceLine: string, key: string): unknown {
  const start = fenceLine.search(new RegExp(`(^|\\s)${key}=\\{`));
  if (start === -1) return null;
  const open = fenceLine.indexOf('{', start);
  let depth = 0;
  let inString = false;
  for (let i = open; i < fenceLine.length; i++) {
    const ch = fenceLine[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(fenceLine.slice(open, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeCaption(text: string): string {
  return text
    .replace(/^(Figure|Table)\s+\d+[.:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick one caption: code literal, then cell metadata, then output metadata.
 * Output metadata is written at execution time and can predate later edits
 * (copy-editing), so it is the last resort. `conflict` flags any disagreement.
 */
export function resolveCaption(captions: CellCaptions): {
  text: string | null;
  from: keyof CellCaptions | null;
  conflict: boolean;
} {
  const order: (keyof CellCaptions)[] = ['code', 'cell', 'output'];
  const present = order.filter((k) => captions[k]);
  const distinct = new Set(present.map((k) => normalizeCaption(captions[k]!)));
  const from = present[0] ?? null;
  return { text: from ? captions[from] : null, from, conflict: distinct.size > 1 };
}

/** Choose one representation per displayable output; drop stream and error outputs. */
export function selectOutputs(outputs: readonly RawOutput[]): {
  outputs: CellOutput[];
  dropped: number;
} {
  const chosen: CellOutput[] = [];
  let dropped = 0;
  for (const out of outputs) {
    if (out.output_type !== 'display_data' && out.output_type !== 'execute_result') {
      dropped++;
      continue;
    }
    const data = out.data ?? {};
    const mime = MIME_PRIORITY.find((m) => m in data) ?? Object.keys(data)[0];
    if (!mime) continue;
    const value = data[mime];
    chosen.push({
      mime,
      data: typeof value === 'string' || Array.isArray(value) ? joinText(value) : JSON.stringify(value),
      metadata: out.metadata ?? {},
    });
  }
  return { outputs: chosen, dropped };
}

/** Every tagged figure/table/video/sound code cell in the notebook, in order. */
export function readTaggedCells(nb: RawNotebook): TaggedCell[] {
  const cells: TaggedCell[] = [];
  (nb.cells ?? []).forEach((cell, index) => {
    if (cell.cell_type !== 'code') return;
    const tags = Array.isArray(cell.metadata?.tags) ? (cell.metadata.tags as string[]) : [];
    const kind = kindFromTags(tags);
    if (!kind) return;
    const source = joinText(cell.source);
    const rawOutputs = cell.outputs ?? [];
    const { outputs, dropped } = selectOutputs(rawOutputs);
    const outputCaption =
      rawOutputs.map((o) => captionFromJdh(o.metadata?.jdh)).find((c) => c) ?? null;
    cells.push({
      index,
      ...kind,
      tags,
      source,
      captions: {
        code: captionFromCode(source),
        cell: captionFromJdh(cell.metadata?.jdh),
        output: outputCaption,
      },
      outputs,
      dropped,
    });
  });
  return cells;
}

/** Load a notebook, or null when the file is missing or unreadable. */
export function loadNotebook(notebookPath: string): RawNotebook | null {
  try {
    return JSON.parse(fs.readFileSync(notebookPath, 'utf8')) as RawNotebook;
  } catch {
    return null;
  }
}

/** Index figure cells by MyST label, so markdown cells can be matched by their tag. */
export function indexFiguresByLabel(cells: readonly TaggedCell[]): Map<string, TaggedCell> {
  const index = new Map<string, TaggedCell>();
  for (const cell of cells) {
    if (cell.kind !== 'figure') continue;
    const label = figureLabelFromTag(cell.tag);
    if (!index.has(label)) index.set(label, cell);
  }
  return index;
}
