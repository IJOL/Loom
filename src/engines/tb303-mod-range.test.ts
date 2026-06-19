import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { TB303Engine } from './tb303';
import type { Voice } from './engine-types';

// The TB-303 filter.cutoff knob/spec is normalized 0..1 and maps EXPONENTIALLY
// to Hz inside the synth (`80 * 100^cutoff`). For "what you see == what you
// hear", cutoff modulation is routed into BiquadFilterNode.detune (cents,
// multiplicative) — NOT .frequency (Hz, additive) — and scaled so a bipolar
// LFO at depth d sweeps the cutoff between base·100^(±d), exactly the
// normalized ±d the amber knob arc draws. The full-knob exponential sweep is
// log2(100) octaves = 1200·log2(100) ≈ 7973 cents.
//
// This test pins that routing + scale. The historic bug summed the LFO
// linearly in Hz over the full ~18 kHz band, slamming the filter shut on a
// few-hundred-Hz base — see tb303-mod-faithful.dsp.test.ts for the audible guard.

const CUTOFF_DETUNE_SPAN_CENTS = 1200 * Math.log2(100);  // ≈ 7972.6 ¢

interface VoiceWithRange extends Voice {
  getAudioParamRange?(id: string): { min: number; max: number } | undefined;
}

describe('TB303Voice — modulation ranges', () => {
  it('routes filter.cutoff modulation into the filter .detune AudioParam (cents)', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination) as VoiceWithRange;
    const dest = voice.getAudioParams().get('filter.cutoff');
    // The modulation destination is the filter's detune (exponential), not its
    // frequency (additive Hz).
    expect(dest).toBe(engine.getInstance()!.filter.detune);
    expect(dest).not.toBe(engine.getInstance()!.filter.frequency);
    voice.dispose();
  });

  it('scales filter.cutoff modulation to a full-knob exponential sweep in cents', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination) as VoiceWithRange;
    const range = voice.getAudioParamRange?.('filter.cutoff');
    expect(range).toBeDefined();
    // depth=1 (bipolar) → ±(max−min) cents = ±(full knob exponential sweep).
    expect(range!.max - range!.min).toBeCloseTo(CUTOFF_DETUNE_SPAN_CENTS, 0);
    voice.dispose();
  });

  it('exposes a Q-scale range for filter.resonance', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination) as VoiceWithRange;
    const range = voice.getAudioParamRange?.('filter.resonance');
    expect(range).toBeDefined();
    // Q sweep across the knob is ~0..25 — well above the spec's 0..1 range.
    expect(range!.max).toBeGreaterThanOrEqual(10);
    voice.dispose();
  });

  it('omits a range for params it does not override (binder will fall back to spec)', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination) as VoiceWithRange;
    // amp.gain is already 0..1 in both the spec and the AudioParam, so no
    // override is needed.
    expect(voice.getAudioParamRange?.('amp.gain')).toBeUndefined();
    voice.dispose();
  });
});
