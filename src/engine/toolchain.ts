import { spawnSync } from 'node:child_process';

/**
 * The PDF toolchain `jdh-cli build` relies on (JDH-051): the MyST CLI runs the
 * export, and MyST in turn runs `typst compile` from the PATH. Neither ships
 * with jdh-cli, so check both before building and say what to install.
 */
export interface ToolSpec {
  name: string;
  command: string;
  /** Supported versions: `min` inclusive, `below` exclusive. */
  min: string;
  below: string;
  install: string[];
}

export const MYST: ToolSpec = {
  name: 'MyST (mystmd)',
  command: 'myst',
  min: '1.10.0',
  below: '2.0.0',
  install: ['npm install -g mystmd', 'https://mystmd.org/guide/installing'],
};

/** Typst versions the template is tested on (JDH-050 moves this to 0.15). */
export const TYPST: ToolSpec = {
  name: 'Typst',
  command: 'typst',
  min: '0.14.0',
  below: '0.15.0',
  install: [
    'brew install typst   (macOS)',
    'cargo install --locked typst-cli',
    'or download a release: https://github.com/typst/typst/releases',
  ],
};

/** First `x.y.z` in a `--version` line: `typst 0.14.2 (unknown hash)` → `0.14.2`, `v1.10.1` → `1.10.1`. */
export function parseVersion(output: string): string | null {
  return output.match(/(\d+)\.(\d+)\.(\d+)/)?.[0] ?? null;
}

/** -1, 0 or 1, comparing dotted versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export type ToolStatus =
  | { tool: ToolSpec; state: 'missing' }
  | { tool: ToolSpec; state: 'ok' | 'unsupported' | 'unknown'; version: string | null };

type Run = (command: string) => { ok: boolean; output: string };

const runVersion: Run = (command) => {
  const res = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (res.error) return { ok: false, output: '' };
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
};

/** Installed version of a tool and whether it is in the supported range. */
export function checkTool(tool: ToolSpec, run: Run = runVersion): ToolStatus {
  const { ok, output } = run(tool.command);
  if (!ok) return { tool, state: 'missing' };
  const version = parseVersion(output);
  if (!version) return { tool, state: 'unknown', version: null };
  const supported = compareVersions(version, tool.min) >= 0 && compareVersions(version, tool.below) < 0;
  return { tool, state: supported ? 'ok' : 'unsupported', version };
}

function range(tool: ToolSpec): string {
  return `>= ${tool.min} and < ${tool.below}`;
}

/** Message for one tool, or null when it is fine. */
export function toolMessage(status: ToolStatus): string | null {
  const { tool } = status;
  if (status.state === 'missing') {
    return [`${tool.name} not found: \`${tool.command}\` is not on the PATH. Install it:`, ...tool.install.map((l) => `  ${l}`)].join('\n');
  }
  if (status.state === 'unsupported') {
    return [
      `${tool.name} ${status.version} is not a tested version (needs ${range(tool)}). The PDF may fail to build or look different.`,
      'Install a supported version:',
      ...tool.install.map((l) => `  ${l}`),
    ].join('\n');
  }
  if (status.state === 'unknown') return `Could not read the ${tool.name} version from \`${tool.command} --version\`.`;
  return null;
}

/**
 * Check MyST and Typst before a PDF build. Missing tools are errors (returned
 * in `errors`); untested versions are warnings. `summary` is a one-line record
 * of the toolchain for the build log.
 */
export function checkToolchain(run: Run = runVersion): { errors: string[]; warnings: string[]; summary: string } {
  const statuses = [checkTool(MYST, run), checkTool(TYPST, run)];
  const errors = statuses.filter((s) => s.state === 'missing').map((s) => toolMessage(s)!);
  const warnings = statuses
    .filter((s) => s.state === 'unsupported' || s.state === 'unknown')
    .map((s) => toolMessage(s)!);
  const summary = statuses
    .map((s) => `${s.tool.name} ${s.state === 'missing' ? 'missing' : (('version' in s && s.version) || '?')}`)
    .join(', ');
  return { errors, warnings, summary };
}
