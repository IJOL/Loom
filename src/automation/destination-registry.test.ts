// The registry wraps listAutomationTargets and adds the subscribe/invalidate
// signal the four picker UIs need. It must add nothing of its own to the
// destination catalogue's CONTENT — that stays owned by listAutomationTargets
// — so these tests exercise the notification contract, not param derivation
// (already covered in automation-targets.test.ts).
//
// The 'insert added later' test uses a REAL registered fx plugin
// (multifilterPlugin), not a bare pluginId string. listAutomationTargets
// silently returns [] for an unregistered plugin id (see fxParams() in
// automation-targets.ts), so asserting against an unregistered id would pass
// or fail for reasons unrelated to this module — exactly the trap this repo
// already hit once with an unregistered 'delay' fixture.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDestinationRegistry } from './destination-registry';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import type { SessionState } from '../session/session';

function stateWith(inserts: { id: string; pluginId: string }[]): SessionState {
  return {
    lanes: [{
      id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [],
      inserts: inserts.map((i) => ({ ...i, params: {}, bypass: false })),
    }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

beforeEach(() => {
  _resetRegistry();
  registerPlugin(multifilterPlugin);
});

afterEach(() => { _resetRegistry(); });

describe('destination registry', () => {
  it('notifies subscribers on invalidate and stops after unsubscribe', () => {
    let state = stateWith([]);
    const reg = createDestinationRegistry({
      getState: () => state,
      getKnobRegistry: () => new Map(),
    });
    const fn = vi.fn();
    const off = reg.subscribe(fn);

    reg.invalidate();
    expect(fn).toHaveBeenCalledTimes(1);

    off();
    reg.invalidate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reflects an insert added after the registry was created', () => {
    let state = stateWith([]);
    const reg = createDestinationRegistry({
      getState: () => state,
      getKnobRegistry: () => new Map(),
    });
    expect(reg.list().some((t) => t.id.includes('fx:'))).toBe(false);

    state = stateWith([{ id: 'slot-a', pluginId: 'multifilter' }]);
    reg.invalidate();
    expect(reg.list().some((t) => t.id.startsWith('poly1.fx:slot-a.'))).toBe(true);
  });

  it('survives a subscriber that throws, so one bad panel cannot mute the rest', () => {
    const reg = createDestinationRegistry({
      getState: () => stateWith([]),
      getKnobRegistry: () => new Map(),
    });
    const good = vi.fn();
    reg.subscribe(() => { throw new Error('boom'); });
    reg.subscribe(good);
    expect(() => reg.invalidate()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
