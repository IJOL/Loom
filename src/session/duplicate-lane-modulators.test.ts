// Duplicating a lane must copy its LIVE modulators, not a stale mirror.
//
// The modulators a lane actually plays live in the engine's ModulationHost.
// `lane.engineState.modulators` is only a serialization sink, refreshed from the
// host at SAVE time (collectEngineState). Duplicate-lane clones the lane in
// memory without a save, so it must read the source lane's live host — otherwise
// a lane duplicated after an LFO edit (but before any save) inherits stale
// modulators. This pins that down so removing the UI mirror (syncModulators)
// cannot silently break it.

import { describe, it, expect } from 'vitest';
import { modulatorsForDuplicatedLane } from './session-host-persistence';
import type { ModulatorState } from '../modulation/types';

const lfo = (id: string, rateHz: number): ModulatorState => ({ scope: 'shared',
  id, kind: 'lfo', enabled: true, connections: [], rateHz, waveform: 'sine',
});

describe('modulatorsForDuplicatedLane', () => {
  it('takes the source lane\'s LIVE host modulators, ignoring a stale engineState copy', () => {
    const liveHost = { serialize: () => [lfo('lfo1', 5)] };
    const staleEngineState = { modulators: [lfo('lfo1', 99)] };   // what a save would have written earlier

    const result = modulatorsForDuplicatedLane(liveHost, staleEngineState);
    expect(result).toEqual([lfo('lfo1', 5)]);   // the live 5 Hz, not the stale 99
  });

  it('is a deep copy — the clone does not share the source array', () => {
    const mods = [lfo('lfo1', 5)];
    const liveHost = { serialize: () => mods };
    const result = modulatorsForDuplicatedLane(liveHost, undefined);
    (result[0] as ModulatorState).rateHz = 1;
    expect(mods[0].rateHz).toBe(5);   // mutating the clone must not touch the source
  });

  it('falls back to the engineState copy when the lane has no live engine yet', () => {
    // A lane whose resources were never allocated has no host to read; the
    // persisted copy is the only thing available.
    const result = modulatorsForDuplicatedLane(undefined, { modulators: [lfo('lfo1', 7)] });
    expect(result).toEqual([lfo('lfo1', 7)]);
  });

  it('yields an empty list when there is neither a host nor a saved copy', () => {
    expect(modulatorsForDuplicatedLane(undefined, undefined)).toEqual([]);
  });
});
