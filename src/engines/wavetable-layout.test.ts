/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { WT_PARAMS, WT_GROUPS } from './wavetable';

describe('the wavetable page, from data', () => {
  it('puts OSC and FILTER on one row, then AMP, then POLY', () => {
    const rows = resolveParamRows(WT_PARAMS, WT_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC', 'FILTER'], ['AMP'], ['POLY'],
    ]);
  });

  it('keeps the section colours from the declared palette', () => {
    const rows = resolveParamRows(WT_PARAMS, WT_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OSC')).toBe('var(--knob-cyan)');
    expect(byTitle.get('FILTER')).toBe('var(--knob-orange)');
    expect(byTitle.get('AMP')).toBe('var(--knob-green)');
  });

  it('leaves no param in a leading ungrouped row — every wavetable param carries a dot-prefix group', () => {
    const rows = resolveParamRows(WT_PARAMS, WT_GROUPS);
    expect(rows[0].sections.every((s) => s.title !== undefined)).toBe(true);
  });
});
