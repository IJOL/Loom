import { describe, it, expect, afterEach } from 'vitest';
import '../../test/setup';
import { TB303Engine } from './tb303';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';

// Regression: changing a TB-303 preset in the live UI did nothing to the
// sound or the knobs.
//
// Root cause: the per-page preset dropdown applied presets by looping
// `instance.setBaseValue(jsonKey, value)` over the preset's params. But the
// TB-303 preset JSON keys are the synth's INTERNAL field names
// (`cutoff`, `resonance`, `envMod`, `decay`, `accent`, `wave`) — NOT the
// engine's EngineParamSpec ids (`filter.cutoff`, `env.amount`, `osc.wave`).
// setBaseValue only recognises the spec ids, so every write silently no-oped.
//
// engine.applyPreset() owns the correct JSON-key→state mapping (it's the path
// the session/scene loader already used). The fix routes the UI through it.
// This test locks both halves of the contract.

const PRESET = {
  name: 'TEST Squelch',
  gm: [] as number[],
  params: { cutoff: 0.9, resonance: 0.8, envMod: 0.7, decay: 0.3, accent: 0.65, wave: 1 },
};

describe('TB303Engine preset application (live-UI regression)', () => {
  afterEach(() => { __resetPresetCache(); });

  it('applyPreset maps the JSON keys onto engine state (sound + knobs change)', () => {
    __seedPresetCache('tb303', [PRESET]);
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination); // establishes lastInstance

    // Baseline: NOT the preset values yet (read from the live TB303 instance,
    // whose defaults differ from the preset — exact value is irrelevant here).
    expect(engine.getBaseValue('filter.cutoff')).not.toBeCloseTo(0.9, 5);
    expect(engine.getBaseValue('osc.wave')).toBe(0);

    engine.applyPreset('TEST Squelch');

    // getBaseValue is what refreshLaneKnobs reads → knobs reflect the preset.
    expect(engine.getBaseValue('filter.cutoff')).toBeCloseTo(0.9, 5);
    expect(engine.getBaseValue('filter.resonance')).toBeCloseTo(0.8, 5);
    expect(engine.getBaseValue('env.amount')).toBeCloseTo(0.7, 5);
    expect(engine.getBaseValue('osc.wave')).toBe(1); // wave:1 → 'square'
  });

  it('the OLD path (setBaseValue with raw preset keys) is a silent no-op', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination);

    const before = engine.getBaseValue('filter.cutoff');
    // Preset JSON key — NOT a setBaseValue spec id. This is exactly what the
    // buggy loop did; it must change nothing, proving why the UI was dead.
    engine.setBaseValue('cutoff', 0.123);
    expect(engine.getBaseValue('filter.cutoff')).toBeCloseTo(before, 5);
  });
});
