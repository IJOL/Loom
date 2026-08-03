/** @vitest-environment jsdom */
// The host's row/section resolver, fed by Wavetable's own declared layout. The
// engine ships as a plugin now, so that layout IS plugins/wavetable/plugin.json.
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import manifest from '../../plugins/wavetable/plugin.json';

const WT_PARAMS = manifest.components[0].params as unknown as EngineParamSpec[];
const WT_GROUPS = manifest.components[0].groups as unknown as EngineParamGroup[];

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
