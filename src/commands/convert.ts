import type { Command } from 'commander';
import { CliError } from '../cli/errors.js';
import { buildRunContext, fileExists, parseConvertOptions, resolveInputPath } from '../engine/context.js';
import { listRulesetSteps, runRuleset } from '../engine/runner.js';
import { getRuleset, inferRulesetId } from '../rulesets/index.js';

export function addConvertCommand(program: Command): void {
  program
    .argument('<input>', 'Jupytext-exported markdown input (.md)')
    .option('--workdir <path>', 'Output workdir name or path', '_improved')
    .option('--project-root <path>', 'Article repo root for assets (default: input directory)')
    .option('-d, --dry-run', 'Do not write files')
    .option('--orcid-lookup', 'Enable ORCID enrichment (extract-jupytext-frontmatter step)')
    .option('--ror-lookup', 'Enable ROR affiliation lookups (default on)')
    .option('--no-ror-lookup', 'Disable ROR affiliation lookups')
    .option('--ror-min-score <float>', 'ROR match threshold 0..1', '0.8')
    .option('--doi <doi>', 'Set project.doi (default: looked up from the JDH API by repo name)')
    .option('--url <url>', 'Set the article URL, project.social.url (default: JDH article page from repo name)')
    .option('--list-steps', 'Print planned steps for this input and exit')
    .addHelpText(
      'after',
      `
Examples:
  $ jdh-cli article.md
  $ jdh-cli article.md --project-root ./article --workdir _improved
  $ jdh-cli article.md --list-steps
  $ jdh-cli article.md --doi 10.1515/jdh-2025-0002 --url https://journalofdigitalhistory.org/en/article/BHmHNQKJaSWT
`,
    )
    .action(async (input: string, opts) => {
      const inputAbs = resolveInputPath(input);
      if (!fileExists(inputAbs)) {
        throw new CliError(`Input file not found: ${inputAbs}`);
      }

      const options = parseConvertOptions({
        dryRun: opts.dryRun,
        workdir: opts.workdir,
        orcidLookup: opts.orcidLookup,
        rorLookup: opts.rorLookup,
        noRorLookup: opts.noRorLookup,
        rorMinScore: opts.rorMinScore,
        projectRoot: opts.projectRoot,
        doi: opts.doi,
        url: opts.url,
      });

      const rulesetId = inferRulesetId(inputAbs);
      const ruleset = getRuleset(rulesetId);
      const ctx = buildRunContext(rulesetId, inputAbs, options);

      if (opts.listSteps) {
        listRulesetSteps(ruleset, ctx);
        return;
      }

      await runRuleset(ruleset, ctx);
    });
}
