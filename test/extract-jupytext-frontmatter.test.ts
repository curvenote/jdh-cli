import { describe, expect, test } from 'bun:test';
import { stripOrcidMarkdownFromName } from '../src/steps/jupytext/extract-jupytext-frontmatter.js';

describe('stripOrcidMarkdownFromName', () => {
  test('removes ORCID badge markdown from author name', () => {
    const raw =
      'Maximilian C. Teich [![orcid](https://orcid.org/sites/default/files/images/orcid_16x16.png)](https://orcid.org/0009-0000-7084-8291)';
    expect(stripOrcidMarkdownFromName(raw)).toBe('Maximilian C. Teich');
  });

  test('leaves plain names unchanged', () => {
    expect(stripOrcidMarkdownFromName('Jane Doe')).toBe('Jane Doe');
  });
});
