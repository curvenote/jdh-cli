/**
 * Cells with metadata in a Jupytext markdown file: `<!-- #region … -->` (or `#raw`)
 * blocks for markdown cells, code fences for code cells.
 */
export interface JupytextCell {
  type: 'markdown' | 'code';
  /** Line of the opening `<!-- #region` comment or code fence. */
  start: number;
  /** Line of the closing `<!-- #endregion -->` comment or code fence. */
  end: number;
  tags: string[];
}

/** Parse `tags=[...]` from a region comment or code fence line. */
export function parseCellTags(line: string): string[] {
  const m = line.match(/tags\s*=\s*(\[[^\]]*\])/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Every region and code fence in the article, outermost only (fences inside a region are part of it). */
export function findJupytextCells(lines: readonly string[]): JupytextCell[] {
  const cells: JupytextCell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const region = lines[i].match(/^<!--\s*#(region|raw)\b/);
    const fence = lines[i].match(/^(`{3,})/);
    if (!region && !fence) continue;
    const close = region ? new RegExp(`^<!--\\s*#end${region[1]}\\s*-->`) : new RegExp(`^\`{${fence![1].length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (j >= lines.length) break;
    cells.push({ type: region ? 'markdown' : 'code', start: i, end: j, tags: parseCellTags(lines[i]) });
    i = j;
  }
  return cells;
}
