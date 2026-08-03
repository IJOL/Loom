// src/session/missing-engine.test.ts
//
// The save path of a lane whose engine is not installed. A lane can outlive its
// engine — a deleted plugin folder, a session written on a machine that had one
// more plugin than this one — and the contract is that it survives untouched:
// install the plugin, reload, and the sound comes back exactly as it was. A save
// that quietly flattens the lane's state breaks that promise permanently, and
// does it without an error.
import { describe, it, expect } from 'vitest';
import type { SessionHost } from './session-host';
import { collectEngineState } from './session-host-persistence';

describe('collectEngineState on a lane whose engine is not installed', () => {
  it('keeps its params and its note-FX instead of stamping them flat', () => {
    // The lane has state and NO engine: laneResources.get() returns undefined,
    // which is exactly what a deleted plugin folder produces. Params were never
    // at risk (they are mirrored by commitParam, not re-read here); noteFx was,
    // because getNoteFxChain mints an empty chain for an unknown lane id.
    const lane = {
      id: 'ghost-1', engineId: 'ghost', name: 'Ghost', clips: [], inserts: [],
      engineState: {
        params: { 'filter.cutoff': 0.42, 'amp.level': 0.9 },
        noteFx: [{ kind: 'arp', enabled: true }],
      },
    };
    const self = {
      state: { lanes: [lane], sends: undefined },
      deps: { laneResources: { get: () => undefined }, fxBus: undefined },
    };

    collectEngineState(self as unknown as SessionHost);

    expect(lane.engineState.params['filter.cutoff']).toBe(0.42);
    expect(lane.engineState.params['amp.level']).toBe(0.9);
    expect(lane.engineState.noteFx).toHaveLength(1);
    expect(lane.engineState.noteFx[0].kind).toBe('arp');
  });

  it('a lane WITH an engine still gets its note-FX chain mirrored', () => {
    // The negative control for the guard above: skipping the mirror for a lane
    // that has no engine must not skip it for one that does, or every real
    // lane's note-FX would stop being saved — a far worse bug than the one the
    // guard fixes. The live chain is empty here (nothing loaded one for this
    // lane id), so the assertion is that the field was WRITTEN, not what it holds.
    const lane = {
      id: 'real-1', engineId: 'subtractive', name: 'Real', clips: [], inserts: [],
      engineState: { params: {} } as { params: Record<string, number>; noteFx?: unknown[] },
    };
    const self = {
      state: { lanes: [lane], sends: undefined },
      deps: {
        laneResources: { get: () => ({ engine: { id: 'subtractive' } }) },
        fxBus: undefined,
      },
    };

    collectEngineState(self as unknown as SessionHost);

    expect(lane.engineState.noteFx).toBeDefined();
  });
});
