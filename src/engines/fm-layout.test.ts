/** @vitest-environment jsdom */
// The host's row/section resolver, fed by FM's own declared layout. FM ships as
// a plugin now, so that layout IS plugins/fm/plugin.json — the manifest is what
// a plugin author writes and the only thing the host can honour, so it is what
// these assertions read.
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import manifest from '../../plugins/fm/plugin.json';

const FM_PARAMS = manifest.components[0].params as unknown as EngineParamSpec[];
const FM_GROUPS = manifest.components[0].groups as unknown as EngineParamGroup[];

describe('the fm page, from data', () => {
  it('shares OP 1/OP 2 on one row and OP 3/OP 4 on the next, UNISON and POLY last', () => {
    const rows = resolveParamRows(FM_PARAMS, FM_GROUPS);
    const titled = rows.filter((r) => r.sections.some((s) => s.title !== undefined));
    expect(titled.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OP 1', 'OP 2'], ['OP 3', 'OP 4'], ['UNISON', 'POLY'],
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

  // These two came from src/engines/fm.test.ts, which read the same facts off
  // the registry through a module that no longer exists. Group ID and display
  // TITLE are different things: the id (op1..op4, matching each operator's own
  // dot-prefix) is a stable key nothing renders, the title is what the user sees
  // painted as the section header. Pin both — the id alone misses a title typo.
  it('tags each operator param with its opN group id, titled OP N', () => {
    const groupOf = (id: string) => FM_PARAMS.find((p) => p.id === id)?.group;
    const titleOf = (groupId: string) => FM_GROUPS.find((g) => g.id === groupId)?.title;
    for (let n = 1; n <= 4; n++) {
      expect(groupOf(`op${n}.ratio`)).toBe(`op${n}`);
      expect(groupOf(`op${n}.release`)).toBe(`op${n}`);
      expect(titleOf(`op${n}`)).toBe(`OP ${n}`);
    }
  });

  it('leaves global params ungrouped', () => {
    for (const id of ['algorithm', 'feedback', 'amp.mix']) {
      expect(FM_PARAMS.find((p) => p.id === id)?.group).toBeUndefined();
    }
  });
});
