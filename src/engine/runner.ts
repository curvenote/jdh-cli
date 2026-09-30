import type { RunContext, Ruleset, StepDisposition } from './types.js';
import { fileExists } from './context.js';

function dispositionLabel(d: StepDisposition): string {
  if (d === 'warn-skip') return 'warn-skip';
  return d;
}

export async function runRuleset(ruleset: Ruleset, ctx: RunContext): Promise<void> {
  const steps = ruleset.steps;
  const total = steps.length;

  console.log(`\nRuleset: ${ruleset.label} (${ruleset.id})`);
  console.log(`Input:   ${ctx.inputAbs}`);
  console.log(`Workdir: ${ctx.workdirAbs}\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const n = i + 1;
    const disposition = step.when ? step.when(ctx) : 'run';

    if (disposition === 'skip') {
      console.log(`=== ${n}/${total} ${step.label} ===\n(skipped)\n`);
      continue;
    }

    if (disposition === 'warn-skip') {
      console.log(`=== ${n}/${total} ${step.label} ===\n(warn-skip: prerequisites not met)\n`);
      continue;
    }

    console.log(`=== ${n}/${total} ${step.label} ===`);
    await step.run(ctx);
    console.log('');

    if (
      ctx.options.dryRun &&
      !fileExists(ctx.workdirAbs) &&
      step.id === 'prepareWorkdir'
    ) {
      console.log(
        '(dry-run: workdir not created, so remaining steps are skipped. Re-run without --dry-run.)\n',
      );
      return;
    }
  }

  if (ctx.options.dryRun && !fileExists(ctx.workdirAbs)) {
    console.log(
      '(dry-run: workdir was not created; subsequent steps that need it were skipped or no-ops.)\n',
    );
    return;
  }

  console.log(`Done. Output is in ${ctx.workdirAbs}/\n`);
}

export function listRulesetSteps(ruleset: Ruleset, ctx: RunContext): void {
  console.log(`\nRuleset: ${ruleset.label} (${ruleset.id})`);
  console.log(`Input:   ${ctx.inputAbs}\n`);
  ruleset.steps.forEach((step, i) => {
    const d = step.when ? step.when(ctx) : 'run';
    const inputs = step.inputs.join(', ');
    console.log(`  ${i + 1}. [${dispositionLabel(d)}] ${step.id} — ${step.label} (${inputs})`);
  });
  console.log('');
}
