import { describe, expect, test } from 'bun:test';
import { checkTool, checkToolchain, compareVersions, MYST, parseVersion, TYPST } from '../src/engine/toolchain.js';

const fake = (outputs: Record<string, string | null>) => (command: string) =>
  outputs[command] == null ? { ok: false, output: '' } : { ok: true, output: outputs[command]! };

describe('toolchain check (JDH-051)', () => {
  test('parses the version lines MyST and Typst print', () => {
    expect(parseVersion('typst 0.14.2 (unknown hash)')).toBe('0.14.2');
    expect(parseVersion('v1.10.1')).toBe('1.10.1');
    expect(parseVersion('no version here')).toBeNull();
  });

  test('compares versions numerically', () => {
    expect(compareVersions('0.14.2', '0.15.0')).toBe(-1);
    expect(compareVersions('0.15.1', '0.15.0')).toBe(1);
    expect(compareVersions('1.10.1', '1.9.0')).toBe(1);
    expect(compareVersions('0.15.0', '0.15.0')).toBe(0);
  });

  test('a missing tool is an error that says how to install it', () => {
    const { errors, warnings, summary } = checkToolchain(fake({ myst: 'v1.10.1', typst: null }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Typst not found');
    expect(errors[0]).toContain('brew install typst');
    expect(warnings).toEqual([]);
    expect(summary).toBe('MyST (mystmd) 1.10.1, Typst missing');
  });

  test('an untested version is a warning naming the supported range', () => {
    const status = checkTool(TYPST, fake({ typst: `typst ${TYPST.below} (abc)` }));
    expect(status.state).toBe('unsupported');
    const { errors, warnings } = checkToolchain(fake({ myst: 'v1.10.1', typst: `typst ${TYPST.below}` }));
    expect(errors).toEqual([]);
    expect(warnings[0]).toContain(`needs >= ${TYPST.min} and < ${TYPST.below}`);
  });

  test('supported versions pass quietly', () => {
    expect(checkTool(MYST, fake({ myst: 'v1.10.1' })).state).toBe('ok');
    expect(checkTool(TYPST, fake({ typst: `typst ${TYPST.min}` })).state).toBe('ok');
  });
});
