/**
 * MyST plugin: `jdh-dialogue` directive for JDH dialogue cells (`dialog-*` tags).
 *
 * The body is the cell's markdown table: one column per speaker (the header
 * row holds the names), one row per turn, `&nbsp;` where a speaker is silent.
 * It becomes a numbered container of kind `dialogue` ("Dialogue N" in the PDF)
 * holding one Typst `raw` call to the template's `#jdh-dialogue(...)`, which
 * draws each turn as a bubble in its speaker's column.
 *
 * Refs: https://mystmd.org/guide/javascript-plugins
 */

import { parseGfmTable } from './lib/table-truncate.mjs';
import { stringToTypstText } from './lib/typst-text.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of a dialogue cell: entities decoded, tags dropped, `<br>` kept as a newline. */
function cellText(raw) {
  return String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\\([\\`*_[\]{}()#+\-.!|])/g, '$1')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Speakers and turns from a dialogue table. Each row keeps one slot per
 * speaker (null when silent); rows where nobody speaks are dropped.
 * @param {string} markdown
 */
export function parseDialogue(markdown) {
  const { headerRows, dataRows } = parseGfmTable(markdown);
  const speakers = (headerRows[0] ?? []).map(cellText);
  const width = Math.max(speakers.length, ...dataRows.map((r) => r.length));
  while (speakers.length < width) speakers.push('');
  const rows = dataRows
    .map((r) => Array.from({ length: width }, (_, i) => cellText(r[i]) || null))
    .filter((r) => r.some((c) => c));
  return { speakers, rows };
}

/** Typst call for the template's `jdh-dialogue` function. */
export function dialogueToTypst({ speakers, rows }) {
  // Each transcribed `<br>` segment goes on its own line (Typst's `\` line break).
  const content = (t) => `[${t.split('\n').map(stringToTypstText).join(' \\ ')}]`;
  const tuple = (items) => `(${items.join(', ')},)`;
  return `#jdh-dialogue(speakers: ${tuple(speakers.map(content))}, rows: ${
    rows.length ? tuple(rows.map((r) => tuple(r.map((c) => (c ? content(c) : 'none'))))) : '()'
  })\n`;
}

const jdhDialogueDirective = {
  name: 'jdh-dialogue',
  doc: 'JDH dialogue: a numbered "Dialogue N" with speech bubbles per speaker. Emitted by improveDialogueRegions.',
  arg: { type: 'myst', doc: 'Optional caption.' },
  options: {
    label: { type: String, required: false },
  },
  body: { type: String, doc: 'Markdown table: speakers as columns, one row per turn.' },
  run(data) {
    let dialogue;
    try {
      dialogue = parseDialogue(data.body ?? '');
    } catch {
      return [{ type: 'paragraph', children: [{ type: 'text', value: data.body ?? '' }] }];
    }
    // The Typst is attached in a document-stage transform (below): built here,
    // MyST's container handling would move it into the caption.
    const container = {
      type: 'container',
      kind: 'dialogue',
      children: [{ type: 'caption', children: [{ type: 'paragraph', children: data.arg ?? [] }] }],
      data: { jdhDialogueTypst: dialogueToTypst(dialogue) },
    };
    const label = data.options?.label;
    if (label) {
      container.label = label;
      container.identifier = label.trim().toLowerCase();
    }
    return [container];
  },
};

/** Put the dialogue body back as the container's only non-caption child. */
export function attachDialogueBody(node) {
  const typst = node.data?.jdhDialogueTypst;
  if (!typst) return;
  // Always keep a caption, so the PDF shows the "Dialogue N" label even without text.
  const caption = (node.children ?? []).find((c) => c.type === 'caption') ?? {
    type: 'caption',
    children: [{ type: 'paragraph', children: [] }],
  };
  caption.children = (caption.children ?? []).filter((c) => c.type !== 'div' && c.type !== 'raw');
  node.children = [caption, { type: 'div', children: [{ type: 'raw', typst }] }];
}

const attachDialogueBodies = {
  name: 'attach-jdh-dialogue-body',
  stage: 'document',
  plugin: (_, utils) => (tree) => {
    utils.selectAll('container', tree).forEach((node) => {
      if (node.kind === 'dialogue') attachDialogueBody(node);
    });
  },
};

const plugin = {
  name: 'JDH Dialogue',
  directives: [jdhDialogueDirective],
  transforms: [attachDialogueBodies],
};

export default plugin;
