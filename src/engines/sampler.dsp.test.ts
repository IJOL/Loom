// src/engines/sampler.dsp.test.ts
// Layer-3 real-DSP tests for the Sampler engine. A synthetic harmonic-rich
// buffer is created inside the SAME OfflineAudioContext as the render and put
// into the cache, so the engine resolves and plays it. Assertions are relative.

import { describe, it, expect, beforeEach } from 'vitest';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';
import { rms, peak, isSilent, spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

const SR = 44100;
const ROOT = 48;

/** Render one or more sampler triggers. The synthetic source is a sum of the
 *  first 8 harmonics of `fundHz` (rich enough for repitch + filter to move the
 *  spectral centroid). */
async function renderSampler(opts: {
  fundHz?: number;
  setup?: (e: SamplerEngine) => void;
  act: (voice: import('./engine-types').Voice) => void;
  durationSec: number;
}): Promise<Float32Array> {
  const fundHz = opts.fundHz ?? 110;
  const ctx = new OfflineAudioContext(1, Math.round(opts.durationSec * SR), SR);

  const len = Math.round(0.5 * SR);
  const buf = ctx.createBuffer(1, len, SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * fundHz * h * i / SR) / h;
    data[i] = s * 0.2;
  }
  sampleCache.put('test', buf);

  const engine = new SamplerEngine();
  engine.setKeymap([{ sampleId: 'test', rootNote: ROOT, loNote: 0, hiNote: 127 }]);
  opts.setup?.(engine);

  const out = ctx.createGain();
  const voice = engine.createVoice(ctx as unknown as AudioContext, out);
  out.connect(ctx.destination);
  opts.act(voice);

  const rendered = await ctx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

describe('SamplerEngine — one-shot DSP', () => {
  beforeEach(() => sampleCache.clear());

  it('produces audible sound when triggered on the root note', async () => {
    const buf = await renderSampler({
      durationSec: 0.4,
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    writeWav(buf, wavPath('sampler__sounds'), SR);
    expect(isSilent(buf)).toBe(false);
    expect(peak(buf)).toBeGreaterThan(0.01);
  });

  it('is silent when no keymap entry covers the note', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(0.2 * SR), SR);
    const engine = new SamplerEngine();
    engine.setKeymap([{ sampleId: 'test', rootNote: ROOT, loNote: ROOT, hiNote: ROOT }]);
    const out = ctx.createGain();
    const voice = engine.createVoice(ctx as unknown as AudioContext, out);
    out.connect(ctx.destination);
    voice.trigger(ROOT + 7, 0, { gateDuration: 0.1 }); // outside range, no cache entry either
    const rendered = await ctx.startRendering();
    expect(isSilent(new Float32Array(rendered.getChannelData(0)))).toBe(true);
  });

  it('an octave up raises the spectral centroid', async () => {
    const low = await renderSampler({
      durationSec: 0.4,
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    const high = await renderSampler({
      durationSec: 0.4,
      act: (v) => v.trigger(ROOT + 12, 0, { gateDuration: 0.3 }),
    });
    writeWav(low,  wavPath('sampler__pitch-root'), SR);
    writeWav(high, wavPath('sampler__pitch-oct'),  SR);
    expect(spectralCentroid(high, SR)).toBeGreaterThan(spectralCentroid(low, SR) * 1.5);
  });

  it('opening the cutoff raises the spectral centroid', async () => {
    const dark = await renderSampler({
      durationSec: 0.4,
      setup: (e) => e.setBaseValue('filter.cutoff', 0.1),
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    const bright = await renderSampler({
      durationSec: 0.4,
      setup: (e) => e.setBaseValue('filter.cutoff', 0.95),
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    writeWav(dark,   wavPath('sampler__cutoff-low'), SR);
    writeWav(bright, wavPath('sampler__cutoff-hi'),  SR);
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });

  it('release cuts the gate', async () => {
    const buf = await renderSampler({
      durationSec: 1.0,
      act: (v) => { v.trigger(ROOT, 0, { gateDuration: 1.0 }); v.release(0.1); },
    });
    writeWav(buf, wavPath('sampler__release'), SR);
    const head = buf.subarray(0, Math.round(0.1 * SR));
    const tail = buf.subarray(buf.length - Math.round(0.05 * SR));
    expect(rms(tail)).toBeLessThan(rms(head) * 0.1);
  });
});
