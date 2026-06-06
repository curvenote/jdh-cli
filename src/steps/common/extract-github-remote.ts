import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStep } from '../../engine/types.js';
import { stepOpts } from '../../engine/step-context.js';
import { findGitRoot, resolveGithubFromGit } from '../shared/git.js';
import { whenGithubRemote } from '../shared/when.js';

const DEFAULT_CONFIG = 'myst.yml';

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readExistingProjectGithub(configPath: string): string | null {
  const content = fs.readFileSync(configPath, 'utf8');
  const m = content.match(/^\s{2}github:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

function insertProjectGithub(configPath: string, url: string, dryRun: boolean): boolean {
  const content = fs.readFileSync(configPath, 'utf8');
  if (!content.includes('project:')) return false;
  const newContent = content.replace('project:\n', `project:\n  github: ${url}\n`);
  if (!dryRun) {
    fs.writeFileSync(configPath, newContent);
  }
  return true;
}

async function extractGithubRemote(options: {
  configPath: string;
  dryRun: boolean;
  cwd: string;
  projectRoot?: string;
}): Promise<void> {
  const configPath = path.resolve(options.cwd, options.configPath || DEFAULT_CONFIG);

  if (!fileExists(configPath) || !fs.statSync(configPath).isFile()) {
    throw new Error(`curvenote file not found: ${configPath}`);
  }

  const existingGithub = readExistingProjectGithub(configPath);
  if (existingGithub) {
    process.stdout.write(
      `project.github already set (${existingGithub}); leaving unchanged.\n`,
    );
    return;
  }

  const repoDir =
    findGitRoot(path.dirname(configPath)) ??
    (options.projectRoot ? findGitRoot(options.projectRoot) : null);
  if (!repoDir) {
    process.stdout.write('No git repository found; leaving project.github unset.\n');
    return;
  }

  const url = resolveGithubFromGit(repoDir);
  if (!url) {
    process.stdout.write('No git remotes found; leaving project.github unset.\n');
    return;
  }

  if (!insertProjectGithub(configPath, url, options.dryRun)) {
    throw new Error('Could not update project.github in curvenote file.');
  }

  if (options.dryRun) {
    process.stdout.write(`[dry-run] would set project.github to ${url}\n`);
    return;
  }

  process.stdout.write(`Set project.github to ${url}\n`);
}

/** Set `project.github` in myst.yml from the nearest ancestor git remote URL. */
export const extractGithubRemoteStep: PipelineStep = {
  id: 'extractGithubRemote',
  label: 'Set project.github from git remote',
  inputs: ['myst', 'git'],
  when: whenGithubRemote,
  run: async (ctx) => {
    const o = stepOpts(ctx);
    await extractGithubRemote({
      configPath: 'myst.yml',
      dryRun: o.dryRun,
      cwd: o.cwd,
      projectRoot: o.projectRoot,
    });
  },
};
