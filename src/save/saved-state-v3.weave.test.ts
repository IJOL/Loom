// The weave has to survive a save/load round trip, and the round trip is the
// only thing that can say so: every piece of it is plain data, so nothing else
// would ever fail.
import { describe, it, expect, vi } from 'vitest';
import { buildSavedStateV3, applyLoadedStateV3, type SavedStateV3Deps } from './saved-state-v3';
import { defaultWeaveState, type WeaveState } from '../weave/weave-state';

/** The bare minimum buildSavedStateV3 reads. Everything else is optional. */
function deps(over: Partial<SavedStateV3Deps> = {}): SavedStateV3Deps {
  const input = (v: string) => ({ value: v }) as HTMLInputElement;
  return {
    seq: { bpm: 120, swing: 0, meter: { num: 4, den: 4 } },
    volInput: input('0.8'),
    bpmInput: input('120'),
    swingInput: input('0'),
    meterSel: input('4/4') as unknown as HTMLSelectElement,
    sessionHost: {
      getStateForSave: () => ({ lanes: [], scenes: [] }),
      replaceSession: vi.fn(),
    },
    renderLanes: vi.fn(),
    master: { gain: { value: 1 } },
    ...over,
  } as unknown as SavedStateV3Deps;
}

const woven = (): WeaveState => ({
  ...defaultWeaveState(),
  lanes: {
    lane1: {
      weave: { kind: 'ab', a: 'clip:c1', b: 'lib:acid-techno:bass:2', x: 0.4 },
      locked: false, harmonyLeader: true,
    },
  },
  macros: { ...defaultWeaveState().macros, density: 0.8 },
  seed: 7,
});

describe('the weave, across a save', () => {
  it('records what the panel is holding', () => {
    const s = buildSavedStateV3(deps({ getWeave: () => woven() }));
    expect(s.weave?.lanes.lane1.weave).toEqual({
      kind: 'ab', a: 'clip:c1', b: 'lib:acid-techno:bass:2', x: 0.4,
    });
    expect(s.weave?.macros.density).toBe(0.8);
    expect(s.weave?.seed).toBe(7);
  });

  it('carries the LIST a lane draws from, in order', () => {
    // The list is a decision about material, so it belongs to the piece rather
    // than to the session that happened to be open — and its order is the whole
    // of it, so a round trip that kept the ids and lost the order would be a
    // different arrangement wearing the same name.
    const live = woven();
    live.lanes.lane1.pool = ['lib:acid-techno:bass:2', 'clip:c1'];
    const s = buildSavedStateV3(deps({ getWeave: () => live }));
    expect(s.weave?.lanes.lane1.pool).toEqual(['lib:acid-techno:bass:2', 'clip:c1']);

    const setWeave = vi.fn();
    applyLoadedStateV3(s, deps({ setWeave }));
    expect(setWeave.mock.calls[0][0].lanes.lane1.pool)
      .toEqual(['lib:acid-techno:bass:2', 'clip:c1']);
  });

  it('COPIES it, because the live weave keeps moving', () => {
    // A save holding the panel's own object would go on changing after it was
    // written, and what landed on disk would be wherever the fader stopped.
    const live = woven();
    const s = buildSavedStateV3(deps({ getWeave: () => live }));
    live.macros.density = 0.1;
    if (live.lanes.lane1.weave?.kind === 'ab') live.lanes.lane1.weave.x = 1;

    expect(s.weave?.macros.density).toBe(0.8);
    expect(s.weave?.lanes.lane1.weave).toMatchObject({ x: 0.4 });
  });

  it('omits it entirely when nothing supplies one', () => {
    // Every caller without a panel keeps working, and the field stays additive.
    expect(buildSavedStateV3(deps()).weave).toBeUndefined();
  });

  it('hands a loaded weave back', () => {
    const setWeave = vi.fn();
    applyLoadedStateV3(
      { schemaVersion: 3, bpm: 120, swing: 0, masterVol: 1, sessionState: { lanes: [] }, weave: woven() } as never,
      deps({ setWeave }),
    );
    expect(setWeave).toHaveBeenCalledTimes(1);
    expect(setWeave.mock.calls[0][0].macros.density).toBe(0.8);
  });

  it('CLEARS the live weave when the save has none', () => {
    // Otherwise loading an untouched session inherits whatever the previous one
    // was weaving — a lane cross-fading loops the user never chose.
    const setWeave = vi.fn();
    applyLoadedStateV3(
      { schemaVersion: 3, bpm: 120, swing: 0, masterVol: 1, sessionState: { lanes: [] } } as never,
      deps({ setWeave }),
    );
    expect(setWeave).toHaveBeenCalledTimes(1);
    expect(setWeave.mock.calls[0][0].lanes).toEqual({});
  });

  it('restores it AFTER the session, because it names clips by id', () => {
    // Those clips have to exist before anything resolves them.
    const order: string[] = [];
    applyLoadedStateV3(
      { schemaVersion: 3, bpm: 120, swing: 0, masterVol: 1, sessionState: { lanes: [] }, weave: woven() } as never,
      deps({
        sessionHost: {
          getStateForSave: () => ({ lanes: [], scenes: [] }),
          replaceSession: () => { order.push('session'); },
        } as never,
        setWeave: () => { order.push('weave'); },
      }),
    );
    expect(order).toEqual(['session', 'weave']);
  });
});
