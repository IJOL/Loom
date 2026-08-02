/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { SUB_PARAM_SPECS } from './subtractive-params';
import { SUB_PARAM_GROUPS } from './subtractive';

describe('the subtractive page, from data', () => {
  // The two oscillators share a line; the three MIXER SOURCES they feed — ring
  // (OSC 1 × OSC 2), sub and noise — share the next.
  it('puts the two oscillators on one row and the three mixer sources on the next', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows[0].sections.map((s) => s.title)).toEqual(['OSC 1', 'OSC 2']);
    expect(rows[1].sections.map((s) => s.title)).toEqual(['RING', 'SUB', 'NOISE']);
  });

  // A filter block per row: seven controls each, two of them radio strips, and a
  // filter reads as one unit rather than as something to scan across a divider.
  it('gives each filter, MASTER and POLY a row of its own', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC 1', 'OSC 2'], ['RING', 'SUB', 'NOISE'],
      ['FILTER A'], ['FILTER B'], ['MASTER'], ['POLY'],
    ]);
  });

  it('keeps the section colours the stylesheet used to key off the div ids', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OSC 1')).toBe('var(--knob-cyan)');
    expect(byTitle.get('OSC 2')).toBe('var(--knob-yellow)');
    expect(byTitle.get('RING')).toBe('var(--knob-red)');
    expect(byTitle.get('SUB')).toBe('var(--knob-blue)');
    expect(byTitle.get('NOISE')).toBe('var(--knob-purple)');
    expect(byTitle.get('FILTER A')).toBe('var(--knob-orange)');
    expect(byTitle.get('FILTER B')).toBe('var(--knob-teal)');
    expect(byTitle.get('MASTER')).toBe('var(--knob-green)');
  });

  it('draws no AMP section — those envelopes belong to the modulators panel', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.flatMap((r) => r.sections.map((s) => s.title))).not.toContain('AMP');
  });
});
