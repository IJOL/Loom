/** @vitest-environment jsdom */
// The host's row/section resolver, fed by West Coast's own declared layout. The
// engine ships as a plugin now, so that layout IS plugins/westcoast/plugin.json.
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import manifest from '../../plugins/westcoast/plugin.json';

const WEST_PARAMS = manifest.components[0].params as unknown as EngineParamSpec[];
const WEST_GROUPS = manifest.components[0].groups as unknown as EngineParamGroup[];

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
