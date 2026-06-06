#!/usr/bin/env node
import { Command } from 'commander';
import { addBuildCommand } from './commands/build.js';
import { addCleanCommand } from './commands/clean.js';
import { addConvertCommand } from './commands/convert.js';
import { handleCliFailure } from './cli/errors.js';
import version from './version.js';

(process as NodeJS.Process & { noDeprecation?: boolean }).noDeprecation = true;

const program = new Command();
program.name('jdh-cli');
program.description(
  'Convert and improve Jupytext notebooks into a MyST-ready project (myst.yml + article.md).',
);
program.showHelpAfterError(true);

addConvertCommand(program);
addCleanCommand(program);
addBuildCommand(program);

program.version(`v${version}`, '-v, --version', 'Print the current version of jdh-cli');

program.exitOverride();

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch(handleCliFailure);
