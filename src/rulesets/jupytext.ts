import type { Ruleset } from '../engine/types.js';
import {
  enrichAffiliationsRorStep,
  extractGithubRemoteStep,
  improveCitationTagsStep,
  initMystConfigStep,
  prepareWorkdirStep,
  setJdhArticleMetadataStep,
} from '../steps/common/index.js';
import {
  citationsJupyterZoteroStep,
  extractJupytextFrontmatterStep,
  extractJupytextPartsStep,
  jupytextTransformSteps,
} from '../steps/jupytext/index.js';

export const jupytextRuleset: Ruleset = {
  id: 'jupytext',
  label: 'Jupytext article (full pipeline)',
  steps: [
    prepareWorkdirStep,
    initMystConfigStep,
    citationsJupyterZoteroStep,
    improveCitationTagsStep,
    extractJupytextFrontmatterStep,
    enrichAffiliationsRorStep,
    extractJupytextPartsStep,
    ...jupytextTransformSteps,
    extractGithubRemoteStep,
    setJdhArticleMetadataStep,
  ],
};
