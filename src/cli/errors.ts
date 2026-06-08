import { CommanderError } from 'commander';

/** User-facing CLI error (no stack trace). */
export class CliError extends Error {
  override name = 'CliError';

  constructor(message: string) {
    super(message);
  }
}

function shouldShowStack(): boolean {
  return process.env.DEBUG === '1' || process.env.DOC_CONVERT_DEBUG === '1';
}

/** Print a concise CLI error and exit. */
export function handleCliFailure(err: unknown): never {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help') {
      process.exit(0);
    }
    if (err.code === 'commander.version') {
      process.exit(0);
    }

    const usageCodes = new Set([
      'commander.missingArgument',
      'commander.missingMandatoryOption',
      'commander.excessArguments',
      'commander.unknownOption',
      'commander.invalidArgument',
    ]);
    if (!usageCodes.has(err.code) && err.message) {
      console.error(`\n${err.message}\n`);
    }

    process.exit(err.exitCode ?? 1);
  }

  const message =
    err instanceof CliError || err instanceof Error ? err.message : String(err);

  console.error(`\nerror: ${message}\n`);

  if (shouldShowStack() && err instanceof Error && err.stack) {
    console.error(err.stack);
  }

  process.exit(1);
}
