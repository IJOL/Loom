import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { TB303Engine } from './tb303';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';
import type { EnginePreset } from './engine-types';

// Regression: changing a TB-303 preset in the live UI did nothing — the knobs
// stayed on the spec defaults (Cutoff 42% = 0.42) and the sound didn't change.
//
// Two compounding root causes, both in TB303Engine:
//
//   1. applyPreset() only wrote when `this.lastInstance` existed and otherwise
//      silently no-oped. But the TB303 instance is created LAZILY on the first
//      note trigger — so a lane whose clip isn't currently playing has
//      lastInstance === null, and every preset apply (boot AND live dropdown)
//      did nothing.
//   2. getBaseValue() returned the static spec default whenever lastInstance
//      was null, ignoring any pending/applied values. refreshLaneKnobs reads
//      getBaseValue to redraw the knobs, so the knobs were frozen on defaults.
//
// The contract: applyPreset followed by getBaseValue must reflect the preset
// EVEN BEFORE a voice exists, because the inspector mounts (and the dropdown
// applies) without playback. These tests run instance-less on purpose.
//
// engine.presets reads getCachedPresets('tb303'); seed that cache and reset it
// before each test so this file is isolated from the others in the suite.

const PRESET: EnginePreset = {
  name: 'TEST Squelch',
  gm: [],
  // TB-303 preset JSON keys are the synth's internal field names.
  params: { cutoff: 0.9, resonance: 0.8, envMod: 0.7, decay: 0.3, accent: 0.65, wave: 1 },
};

describe('TB303Engine preset application (live-UI regression)', () => {
  beforeEach(() => { __resetPresetCache(); __seedPresetCache('tb303', [PRESET]); });

  it('applyPreset is reflected by getBaseValue WITHOUT a voice (knobs follow)', () => {
    const engine = new TB303Engine();
    // NO createVoice — mirrors opening the 303 inspector / changing the preset
    // dropdown before any note has played. lastInstance is null here.

    expect(engine.getBaseValue('filter.cutoff')).not.toBeCloseTo(0.9, 5);

    engine.applyPreset('TEST Squelch');

    // getBaseValue is exactly what refreshLaneKnobs reads → the knobs.
    expect(engine.getBaseValue('filter.cutoff')).toBeCloseTo(0.9, 5);
    expect(engine.getBaseValue('filter.resonance')).toBeCloseTo(0.8, 5);
    expect(engine.getBaseValue('env.amount')).toBeCloseTo(0.7, 5);
    expect(engine.getBaseValue('env.decay')).toBeCloseTo(0.3, 5);
    expect(engine.getBaseValue('env.accent')).toBeCloseTo(0.65, 5);
    expect(engine.getBaseValue('osc.wave')).toBe(1); // wave:1 → 'square'
  });

  it('a preset applied instance-less survives into the first voice (sound follows)', () => {
    const engine = new TB303Engine();
    engine.applyPreset('TEST Squelch');     // before any voice

    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination); // now the TB303 is built + flushed

    expect(engine.getBaseValue('filter.cutoff')).toBeCloseTo(0.9, 5);
    expect(engine.getBaseValue('osc.wave')).toBe(1);
  });
});
