import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { TB303Engine } from './tb303';
import type { Voice } from './engine-types';

// The TB-303 filter.cutoff knob/spec is 0..1 (a normalized knob that maps
// exponentially to 80..8000 Hz inside the engine). But the AudioParam the
// modulator binder writes to is BiquadFilterNode.frequency in Hz. Without
// an explicit getAudioParamRange override, the binder uses the spec's 0..1
// range to scale modulation depth — so an LFO at depth 0.5 contributes
// ±0.5 Hz to a 1000 Hz filter. Inaudible.
//
// This test pins the canonical Hz operating ranges the voice exposes so
// the binder scales modulator output in the right units.

interface VoiceWithRange extends Voice {
  getAudioParamRange?(id: string): { min: number; max: number } | undefined;
}

describe('TB303Voice — modulation ranges', () => {
  it('exposes a Hz-scale range for filter.cutoff so LFO modulation is audible', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination) as VoiceWithRange;
    const range = voice.getAudioParamRange?.('filter.cutoff');
    expect(range).toBeDefined();
    // The TB-303 sweep band is roughly 80..18000 Hz (see core/synth.ts
    // trigger: `80 * Math.pow(100, p.cutoff)` and the 18 kHz envelope cap).
    expect(range!.min).toBeGreaterThanOrEqual(20);
    expect(range!.min).toBeLessThanOrEqual(200);
    expect(range!.max).toBeGreaterThanOrEqual(8000);
    voice.dispose();
  });

  it('exposes a Q-scale range for filter.resonance', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination) as VoiceWithRange;
    const range = voice.getAudioParamRange?.('filter.resonance');
    expect(range).toBeDefined();
    // Q typically 0..30 — well above the spec's 0..1 normalized range.
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
