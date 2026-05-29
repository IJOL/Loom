import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { TB303Engine } from './tb303';
import type { ModulatorVoice } from '../modulation/types';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

// The TB-303 is monophonic, but the polyhost trigger pipeline calls
// engine.createVoice() on EVERY note. Until now that spawned a fresh set
// of LFO/ADSR voices per note — each LFO started its phase at
// ctx.currentTime, so even with trigger='free' the modulator never
// completed a cycle before being replaced. Symptom: an LFO at 4 Hz with
// notes every 100 ms looked like a still pixel on a knob.
//
// The fix is to spawn the engine's modulators once and REUSE them across
// createVoice calls (same pattern the drums engine uses).

interface EngineWithMods {
  readonly modulators: { modulators: Array<{ id: string }> };
  // Internal — exposed via the cast below.
  engineModVoices?: Map<string, ModulatorVoice> | null;
}

describe('TB303Engine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices Map across calls', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('tb-303-1');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as EngineWithMods).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as EngineWithMods).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBeDefined();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
