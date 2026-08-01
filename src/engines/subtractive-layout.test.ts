/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { SUB_PARAM_SPECS } from './subtractive-params';
import { SUB_PARAM_GROUPS } from './subtractive';

describe('the subtractive page, from data', () => {
  it('puts OSC 1, OSC 2, SUB and NOISE on one row, in that order', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows[0].sections.map((s) => s.title)).toEqual(['OSC 1', 'OSC 2', 'SUB', 'NOISE']);
  });

  it('gives FILTER and MASTER their own rows', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC 1', 'OSC 2', 'SUB', 'NOISE'], ['FILTER'], ['MASTER'], ['POLY'],
    ]);
  });

  it('keeps the section colours the stylesheet used to key off the div ids', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OSC 1')).toBe('var(--knob-cyan)');
    expect(byTitle.get('OSC 2')).toBe('var(--knob-yellow)');
    expect(byTitle.get('SUB')).toBe('var(--knob-blue)');
    expect(byTitle.get('NOISE')).toBe('var(--knob-purple)');
    expect(byTitle.get('FILTER')).toBe('var(--knob-orange)');
    expect(byTitle.get('MASTER')).toBe('var(--knob-green)');
  });

  it('draws no AMP section — those envelopes belong to the modulators panel', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.flatMap((r) => r.sections.map((s) => s.title))).not.toContain('AMP');
  });
});
