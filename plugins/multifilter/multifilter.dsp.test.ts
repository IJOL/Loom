// The Filter insert's freq modulation must route into BiquadFilterNode.detune
// (cents, exponential) so an LFO on an insert filter (e.g. on an audio lane)
// sweeps the cutoff audibly — instead of the old default insert-param range of
// 0..1 that added ±1 Hz (inaudible).
//
// Keeps the .dsp suffix: it renders through OfflineAudioContext, and that is
// what the suffix separates (npm run test:dsp). Renaming it would drop it out
// of that group with nothing to say so.

import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import type { FxInstance } from '@loom/plugin-sdk';
import manifest from './plugin.json';
import { spectralCentroid } from '../../test/dsp-asserts';

// The plugin's own test, run against the plugin the way the host runs it.
let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

const SR = 44100;

async function renderWithFreqMod(detuneCents: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = create(ctx as unknown as AudioContext);
  fx.setBaseValue('type', 0);       // lowpass
  fx.setBaseValue('freq', 250);     // base cutoff 250 Hz
  fx.setBaseValue('q', 1);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 110;
  osc.connect(fx.input);
  fx.output.connect(ctx.destination);
  osc.start();

  // The modulation destination for 'freq' is the filter's .detune (cents).
  const freqMod = fx.getAudioParams().get('freq')!;
  freqMod.value = detuneCents;

  const buf = await ctx.startRendering();
  return new Float32Array(buf.getChannelData(0));
}

describe('Filter insert — freq modulation routes to detune (cents)', () => {
  it('declares a full-knob exponential cents span for freq (not the 0..1 default)', () => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const fx = create(ctx as unknown as AudioContext);
    const range = fx.getAudioParamRange!('freq')!;
    // 20 Hz..20 kHz = log2(1000) octaves ≈ 11959 cents.
    expect(range.max - range.min).toBeCloseTo(1200 * Math.log2(1000), 0);
  });

  it('a positive detune opens the lowpass (brighter) — i.e. freq mod is audible', async () => {
    const dark   = await renderWithFreqMod(0);       // cutoff 250 Hz
    const bright = await renderWithFreqMod(4800);     // 250·2^4 = 4000 Hz
    const cDark   = spectralCentroid(dark, SR);
    const cBright = spectralCentroid(bright, SR);
    // Opening the filter 4 octaves must lift the spectral centroid clearly.
    expect(cBright).toBeGreaterThan(cDark * 1.5);
  });
});
