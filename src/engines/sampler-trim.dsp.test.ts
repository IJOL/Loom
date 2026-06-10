// src/engines/sampler-trim.dsp.test.ts
// Layer-3 real-DSP test: trimming sampleEnd reduces playback energy.
// Bootstrap mirrors sampler.dsp.test.ts exactly.

import { describe, it, expect, beforeEach } from 'vitest';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';

const SR = 44100;
const NOTE = 60;

function rms(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / data.length);
}

/** Render a one-shot trigger at NOTE=60 using a 1s full-scale-ish tone buffer,
 *  with the given sampleEnd fraction (0..1). Returns RMS of the full render. */
async function renderWithSampleEnd(sampleEnd: number): Promise<number> {
  // 1-second 440 Hz tone — simple and audible
  const bufLen = SR; // 1 s
  const renderDur = 1.2; // render window is longer than the buffer
  const ctx = new OfflineAudioContext(1, Math.round(renderDur * SR), SR);

  const buf = ctx.createBuffer(1, bufLen, SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
  }
  sampleCache.put('trim-test', buf);

  const engine = new SamplerEngine();
  engine.setKeymap([{ sampleId: 'trim-test', rootNote: NOTE, loNote: 0, hiNote: 127 }]);
  // Set per-pad sampleEnd via the engine's setBaseValue seam
  engine.setBaseValue('zone60.sampleEnd', sampleEnd);

  const out = ctx.createGain();
  const voice = engine.createVoice(ctx as unknown as AudioContext, out);
  out.connect(ctx.destination);
  voice.trigger(NOTE, 0, { gateDuration: renderDur });

  const rendered = await ctx.startRendering();
  return rms(new Float32Array(rendered.getChannelData(0)));
}

describe('Sampler trim — sampleEnd (DSP, relative)', () => {
  beforeEach(() => sampleCache.clear());

  it('trimming sampleEnd to 0.5 reduces total energy vs full playback', async () => {
    const full = await renderWithSampleEnd(1.0);
    const half = await renderWithSampleEnd(0.5);
    // half should have less energy (about half the samples played)
    expect(half).toBeLessThan(full);
    // but still audible (not silence)
    expect(half).toBeGreaterThan(0);
  });

  it('sampleEnd=1.0 produces audible output', async () => {
    const full = await renderWithSampleEnd(1.0);
    expect(full).toBeGreaterThan(0);
  });
});
