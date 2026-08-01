/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { FM_PARAMS, FM_GROUPS } from './fm';

describe('the fm page, from data', () => {
  it('shares OP 1/OP 2 on one row and OP 3/OP 4 on the next, POLY last', () => {
    const rows = resolveParamRows(FM_PARAMS, FM_GROUPS);
    const titled = rows.filter((r) => r.sections.some((s) => s.title !== undefined));
    expect(titled.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OP 1', 'OP 2'], ['OP 3', 'OP 4'], ['POLY'],
    ]);
  });

  it('keeps algorithm, feedback and mix in the leading ungrouped row — global controls, not an operator', () => {
    const rows = resolveParamRows(FM_PARAMS, FM_GROUPS);
    const leading = rows[0];
    expect(leading.sections).toHaveLength(1);
    expect(leading.sections[0].title).toBeUndefined();
    expect(leading.sections[0].specs.map((s) => s.id)).toEqual(['algorithm', 'feedback', 'amp.mix']);
  });

  it('keeps the operator colours from the declared palette', () => {
    const rows = resolveParamRows(FM_PARAMS, FM_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OP 1')).toBe('var(--knob-cyan)');
    expect(byTitle.get('OP 2')).toBe('var(--knob-yellow)');
    expect(byTitle.get('OP 3')).toBe('var(--knob-blue)');
    expect(byTitle.get('OP 4')).toBe('var(--knob-purple)');
  });
});
