// src/polysynth/polysynth-builtin-env.dsp.test.ts
// Layer-3 DSP: the built-in amp/filter envelope bypass flags on PolySynth.
import { describe, it, expect } from 'vitest';
import { PolySynth } from './polysynth';
import { rms, spectralCentroid } from '../../test/dsp-asserts';

async function renderPoly(configure: (ps: PolySynth) => void): Promise<Float32Array> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.floor(sr * 0.4), sr);
  const ps = new PolySynth(ctx as unknown as AudioContext, ctx.destination);
  configure(ps);
  ps.trigger(48, 0, 0.2, false);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

describe('PolySynth built-in envelope bypass', () => {
  it('amp envelope on (default) produces audible output', async () => {
    const buf = await renderPoly(() => { /* defaults */ });
    expect(rms(buf)).toBeGreaterThan(0.001);
  });

  it('amp envelope off silences the voice when nothing else drives amp.gain', async () => {
    const on  = await renderPoly(() => { /* defaults */ });
    const off = await renderPoly((ps) => { ps.ampEnvEnabled = false; });
    expect(rms(off)).toBeLessThan(rms(on) * 0.02);
  });

  it('filter envelope off removes the cutoff sweep (lower spectral centroid)', async () => {
    // Low base cutoff + high env amount: with the filter env ON the attack
    // opens the filter wide; OFF parks it at the dark base cutoff.
    const cfg = (ps: PolySynth) => {
      ps.params.filter.cutoff = 0.1;
      ps.params.filter.envAmount = 1.0;
      ps.params.filter.attack = 0.005;
      ps.params.filter.decay = 0.3;
      ps.params.filter.sustain = 0.9;
    };
    const onBuf  = await renderPoly((ps) => { cfg(ps); });
    const offBuf = await renderPoly((ps) => { cfg(ps); ps.filterEnvEnabled = false; });
    expect(spectralCentroid(onBuf, 44100)).toBeGreaterThan(spectralCentroid(offBuf, 44100) * 1.2);
  });
});
