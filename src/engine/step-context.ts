import path from 'node:path';
import type { RunContext } from './types.js';

/** Map pipeline RunContext to step runner options (cwd = workdir). */
export function stepOpts(ctx: RunContext) {
  return {
    cwd: ctx.workdirAbs,
    dryRun: ctx.options.dryRun,
    projectRoot: ctx.projectRoot,
    metadataPath: path.join(ctx.projectRoot, 'meta-jdh.yml'),
  };
}
