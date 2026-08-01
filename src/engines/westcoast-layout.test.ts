/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { WEST_PARAMS, WEST_GROUPS } from './westcoast';

describe('the westcoast page, from data', () => {
  it('gives OSC and CONTOUR their own rows, packs TIMBRE+LPG and AMP+MASTER, POLY last', () => {
    const rows = resolveParamRows(WEST_PARAMS, WEST_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC'], ['TIMBRE', 'LPG'], ['CONTOUR'], ['AMP', 'MASTER'], ['POLY'],
    ]);
  });

  it('keeps the section colours from the declared palette, matching the dead west-*-knobs CSS precedent', () => {
    const rows = resolveParamRows(WEST_PARAMS, WEST_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OSC')).toBe('var(--knob-cyan)');
    expect(byTitle.get('TIMBRE')).toBe('var(--knob-orange)');
    expect(byTitle.get('LPG')).toBe('var(--knob-purple)');
    expect(byTitle.get('CONTOUR')).toBe('var(--knob-red)');
    expect(byTitle.get('AMP')).toBe('var(--knob-green)');
    expect(byTitle.get('MASTER')).toBe('var(--knob-teal)');
  });

  it('leaves no param in a leading ungrouped row — every westcoast param carries a dot-prefix group', () => {
    const rows = resolveParamRows(WEST_PARAMS, WEST_GROUPS);
    expect(rows[0].sections.every((s) => s.title !== undefined)).toBe(true);
  });
});
