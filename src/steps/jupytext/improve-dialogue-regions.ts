import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { captionFromJdh, parseFenceMetadata } from '../shared/notebook-cells.js';

const DIALOG_TAG = /^dialog(?:ue)?(?=$|[-_:])/i;

/** MyST label for a dialogue tag: `dialog-worldcup-*` → `dlg:worldcup`. */
export function dialogueLabelFromTag(tag: string): string {
  const slug = tag
    .replace(/^dialog(?:ue)?[-_:]?/i, '')
    .replace(/[-_]?\*$/, '')
    .replace(/^[-_]+|[-_]+$/g, '');
  return `dlg:${slug}`;
}

function parseTags(regionLine: string): string[] {
  const m = regionLine.match(/tags\s*=\s*\[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((t) => t[1]) : [];
}

/**
 * Replace the markdown table in each `dialog-*` region with a `{jdh-dialogue}`
 * directive (speech bubbles, numbered "Dialogue N" in the PDF). The region
 * markers stay, so a `hermeneutics` tag on the same cell still wraps it.
 */
export function processArticle(content: string): { content: string; converted: string[] } {
  const converted: string[] = [];
  const regionRe = /^(<!--\s*#region\b([^\n]*?)-->[ \t]*\n)([\s\S]*?)(^<!--\s*#endregion\s*-->)/gm;
  const out = content.replace(regionRe, (whole, open: string, attrs: string, body: string, close: string) => {
    const tag = parseTags(attrs).find((t) => DIALOG_TAG.test(t));
    const table = body.trim();
    if (!tag || !table.includes('|')) return whole;
    const label = dialogueLabelFromTag(tag);
    const caption = captionFromJdh(parseFenceMetadata(attrs, 'jdh'));
    converted.push(label);
    return [
      open.trimEnd(),
      '```{jdh-dialogue}' + (caption ? ` ${caption.replace(/\s+/g, ' ')}` : ''),
      `:label: ${label}`,
      '',
      table,
      '```',
      close,
    ].join('\n');
  });
  return { content: out, converted };
}

/**
 * Turn JDH dialogue cells (`dialog-*` markdown regions) into `{jdh-dialogue}`
 * directives (JDH-007).
 */
export const improveDialogueRegionsStep: PipelineStep = {
  id: 'improveDialogueRegions',
  label: 'Improve dialogue regions (jdh-dialogue directives)',
  inputs: ['markdown'],
  run: async (ctx) => {
    const o = stepOpts(ctx);
    const articlePath = path.resolve(o.cwd, 'article.md');
    const content = fs.readFileSync(articlePath, 'utf8');
    const { content: next, converted } = processArticle(content);
    if (!converted.length) {
      process.stdout.write('No dialogue regions found; no changes.\n');
      return;
    }
    if (!o.dryRun) fs.writeFileSync(articlePath, next, 'utf8');
    process.stdout.write(
      `${o.dryRun ? '[dry-run] Would convert' : 'Converted'} ${converted.length} dialogue(s): ${converted.join(', ')}.\n`,
    );
  },
};
