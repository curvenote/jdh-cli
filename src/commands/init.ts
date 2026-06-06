import type { Command } from 'commander';
import { CliError } from '../cli/errors.js';
import { resolveProjectRoot } from '../engine/paths.js';
import { initProjectConfig } from '../init/project-config.js';

export function addInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create myst.yml and meta-jdh.yml for a new JDH article repo')
    .argument('[dir]', 'Directory to initialize', '.')
    .addHelpText(
      'after',
      `
Creates myst.yml (with extends: meta-jdh.yml) and copies the bundled meta-jdh.yml
template (license, exports, toc). Sets project.id and project.github from git.

If myst.yml or curvenote.yml already exists, reports that the folder is
already initialized and makes no changes. Creates the target directory
when it does not exist yet.

Examples:
  $ jdh-cli init
  $ jdh-cli init ./my-article
`,
    )
    .action((dir: string) => {
      const projectRoot = resolveProjectRoot(dir);

      let result;
      try {
        result = initProjectConfig(projectRoot);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }

      if (result.status === 'already-initialized') {
        console.log(`Already initialized: ${result.existing} exists in ${result.dir}`);
        return;
      }

      console.log(`Created ${result.mystPath}`);
      console.log(`Created ${result.metaJdhPath} (from bundled template)`);
      console.log(`  project.id: ${result.projectId}`);
      if (result.github) {
        console.log(`  project.github: ${result.github}`);
      } else {
        console.log('  project.github: (not set — no git remote found)');
      }
    });
}
