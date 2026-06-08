/**
 * Steps that only apply to Jupytext-exported markdown (region tags, notebook metadata).
 */
import type { PipelineStep } from '../../engine/types.js';
import { improveHermeneuticsBlocksStep } from './improve-hermeneutics-blocks.js';
import { improveJupytextTablesStep } from './improve-jupytext-tables.js';
import { improveNotebookFiguresStep } from './improve-notebook-figures.js';

export { citationsJupyterZoteroStep } from './citations-jupyter-zotero.js';
export { extractJupytextFrontmatterStep } from './extract-jupytext-frontmatter.js';
export { extractJupytextPartsStep } from './extract-jupytext-parts.js';
export { improveNotebookFiguresStep } from './improve-notebook-figures.js';
export { improveJupytextTablesStep } from './improve-jupytext-tables.js';
export { improveHermeneuticsBlocksStep } from './improve-hermeneutics-blocks.js';

/** Region / notebook transforms (run after extract-jupytext-parts in the full jupytext chain). */
export const jupytextTransformSteps: PipelineStep[] = [
  improveNotebookFiguresStep,
  improveJupytextTablesStep,
  improveHermeneuticsBlocksStep,
];
