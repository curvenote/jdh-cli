import fs from 'node:fs';
import path from 'node:path';
import type { ConvertOptions, RunContext, RulesetId } from './types.js';

const DEFAULT_WORKDIR = '_improved';

export function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveInputPath(input: string): string {
  return path.resolve(process.cwd(), input);
}

export function buildRunContext(
  rulesetId: RulesetId,
  inputAbs: string,
  options: ConvertOptions,
): RunContext {
  const projectRoot = path.resolve(options.projectRoot ?? path.dirname(inputAbs));
  const workdir = options.workdir ?? DEFAULT_WORKDIR;
  const workdirAbs = path.isAbsolute(workdir)
    ? workdir
    : path.resolve(projectRoot, workdir);

  return {
    rulesetId,
    inputPath: inputAbs,
    inputAbs,
    projectRoot,
    workdir,
    workdirAbs,
    articleMd: path.join(workdirAbs, 'article.md'),
    articleIpynb: path.join(workdirAbs, 'article.ipynb'),
    mystYml: path.join(workdirAbs, 'myst.yml'),
    options,
  };
}

export function parseConvertOptions(opts: {
  dryRun?: boolean;
  workdir?: string;
  orcidLookup?: boolean;
  rorLookup?: boolean;
  noRorLookup?: boolean;
  rorMinScore?: string;
  projectRoot?: string;
}): ConvertOptions {
  const rorMinScore = opts.rorMinScore != null ? Number(opts.rorMinScore) : 0.8;
  if (!Number.isFinite(rorMinScore) || rorMinScore < 0 || rorMinScore > 1) {
    throw new Error(`--ror-min-score must be between 0 and 1 (got ${opts.rorMinScore})`);
  }

  return {
    dryRun: Boolean(opts.dryRun),
    workdir: opts.workdir ?? DEFAULT_WORKDIR,
    orcidLookup: Boolean(opts.orcidLookup),
    rorLookup: opts.noRorLookup ? false : opts.rorLookup !== false,
    rorMinScore,
    projectRoot: opts.projectRoot,
  };
}
