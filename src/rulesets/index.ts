import path from 'node:path';
import type { Ruleset, RulesetId } from '../engine/types.js';
import { jupytextRuleset } from './jupytext.js';

export function inferRulesetId(inputAbs: string): RulesetId {
  const ext = path.extname(inputAbs).toLowerCase();
  if (ext === '.md' || ext === '.markdown') {
    return 'jupytext';
  }
  throw new Error(`Unsupported input extension "${ext}". Use .md (Jupytext-exported markdown).`);
}

export function getRuleset(id: RulesetId): Ruleset {
  switch (id) {
    case 'jupytext':
      return jupytextRuleset;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export { jupytextRuleset };
