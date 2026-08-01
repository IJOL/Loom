/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { TB303_PARAMS, TB303_GROUPS } from './tb303';

describe('the tb303 page, from data', () => {
  it('puts OSC, FILTER and ENV on one row, in that order', () => {
    const rows = resolveParamRows(TB303_PARAMS, TB303_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC', 'FILTER', 'ENV'],
    ]);
  });

  it('keeps the section colours from the declared palette', () => {
    const rows = resolveParamRows(TB303_PARAMS, TB303_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OSC')).toBe('var(--knob-cyan)');
    expect(byTitle.get('FILTER')).toBe('var(--knob-orange)');
    expect(byTitle.get('ENV')).toBe('var(--knob-purple)');
  });

  it('declares no POLY section — the 303 is mono', () => {
    const rows = resolveParamRows(TB303_PARAMS, TB303_GROUPS);
    expect(rows.flatMap((r) => r.sections.map((s) => s.title))).not.toContain('POLY');
  });
});
