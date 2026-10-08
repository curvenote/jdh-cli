/**
 * Steps that only apply to Jupytext-exported markdown (region tags, notebook metadata).
 */
import type { PipelineStep } from '../../engine/types.js';
import { dropHiddenCellsStep } from './drop-hidden-cells.js';
import { improveDialogueRegionsStep } from './improve-dialogue-regions.js';
import { improveHermeneuticsBlocksStep } from './improve-hermeneutics-blocks.js';
import { improveUntaggedImageOutputsStep } from './improve-untagged-image-outputs.js';
import { improveJupytextAnchorsStep } from './improve-jupytext-anchors.js';
import { improveJupytextTablesStep } from './improve-jupytext-tables.js';
import { improveNotebookFiguresStep } from './improve-notebook-figures.js';
import { improveNotebookTablesStep } from './improve-notebook-tables.js';

export { citationsJupyterZoteroStep } from './citations-jupyter-zotero.js';
export { extractJupytextFrontmatterStep } from './extract-jupytext-frontmatter.js';
export { extractJupytextPartsStep } from './extract-jupytext-parts.js';
export { improveNotebookFiguresStep } from './improve-notebook-figures.js';
export { improveNotebookTablesStep } from './improve-notebook-tables.js';
export { improveJupytextTablesStep } from './improve-jupytext-tables.js';
export { improveHermeneuticsBlocksStep } from './improve-hermeneutics-blocks.js';
export { improveDialogueRegionsStep } from './improve-dialogue-regions.js';
export { dropHiddenCellsStep } from './drop-hidden-cells.js';
export { improveJupytextAnchorsStep } from './improve-jupytext-anchors.js';
export { numberCellsStep } from './number-cells.js';
export { improveUntaggedImageOutputsStep } from './improve-untagged-image-outputs.js';

/** Region / notebook transforms (run after extract-jupytext-parts in the full jupytext chain). */
export const jupytextTransformSteps: PipelineStep[] = [
  dropHiddenCellsStep,
  improveJupytextAnchorsStep,
  improveNotebookFiguresStep,
  improveNotebookTablesStep,
  improveJupytextTablesStep,
  improveDialogueRegionsStep,
  improveHermeneuticsBlocksStep,
  improveUntaggedImageOutputsStep,
];
