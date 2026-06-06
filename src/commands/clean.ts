import fs from 'node:fs';
import type { Command } from 'commander';
import { CliError } from '../cli/errors.js';
import { fileExists } from '../engine/context.js';
import {
  DEFAULT_WORKDIR,
  removeLegacyArtifacts,
  resolveProjectRoot,
  resolveWorkdirAbs,
} from '../engine/paths.js';

export function addCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Remove the pipeline workdir and legacy .bak artifacts')
    .option('--workdir <path>', 'Workdir to remove', DEFAULT_WORKDIR)
    .option('--project-root <path>', 'Article repo root', process.cwd())
    .option('-d, --dry-run', 'Do not write files')
    .addHelpText(
      'after',
      `
Examples:
  $ jdh-cli clean
  $ jdh-cli clean --project-root ./article --workdir _improved
  $ jdh-cli clean --dry-run
`,
    )
    .action((opts) => {
      const projectRoot = resolveProjectRoot(opts.projectRoot);
      const dryRun = Boolean(opts.dryRun);

      let workdirAbs: string;
      try {
        workdirAbs = resolveWorkdirAbs(projectRoot, opts.workdir);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }

      let removedWorkdir = false;
      if (fileExists(workdirAbs)) {
        console.log(`${dryRun ? '[dry-run] would remove' : 'Removing'} ${workdirAbs}`);
        if (!dryRun) fs.rmSync(workdirAbs, { recursive: true, force: true });
        removedWorkdir = true;
      } else {
        console.log(`No workdir to remove at ${workdirAbs}`);
      }

      const removedLegacy = removeLegacyArtifacts(projectRoot, dryRun);

      console.log(
        [
          dryRun ? '[dry-run] Done.' : 'Done.',
          removedWorkdir ? '' : ' (workdir was already absent)',
          removedLegacy > 0 ? ` (${removedLegacy} legacy artifact(s) cleaned up)` : '',
          '',
        ].join(''),
      );
    });
}
