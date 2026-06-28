import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ChannelFilter } from './channel-filter';
import { spectralCentroid, rms } from '../../test/dsp-asserts';

const SR = 44100;

async function renderSaw(setup: (cf: ChannelFilter) => void): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const cf = new ChannelFilter(ctx);
  setup(cf);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 110;
  osc.connect(cf.input);
  cf.output.connect(ctx.destination);
  osc.start();
  const buf = await ctx.startRendering();
  return new Float32Array(buf.getChannelData(0));
}

describe('ChannelFilter DSP', () => {
  it('a low cutoff removes high-frequency energy (lower spectral centroid)', async () => {
    const open = await renderSaw(() => { /* default 20 kHz */ });
    const dark = await renderSaw((cf) => cf.setCutoff(300));
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.6);
  });

  it('at the default cutoff (20 kHz) + min Q the signal passes through near-unchanged', async () => {
    // Compare the filter at default vs a bare wire (no filter) — same source.
    const ctx = new OfflineAudioContext(1, SR, SR);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 110;
    osc.connect(ctx.destination);
    osc.start();
    const bare = new Float32Array((await ctx.startRendering()).getChannelData(0));

    const filtered = await renderSaw(() => { /* default */ });
    // Spectral centroid within a tight relative tolerance of the unfiltered signal.
    const cBare = spectralCentroid(bare, SR);
    const cFilt = spectralCentroid(filtered, SR);
    expect(Math.abs(cFilt - cBare) / cBare).toBeLessThan(0.05);
    // And overall energy essentially preserved.
    expect(rms(filtered) / rms(bare)).toBeGreaterThan(0.9);
  });

  it('raising Q at a mid cutoff lifts energy near the cutoff (resonant peak)', async () => {
    const flat = await renderSaw((cf) => { cf.setCutoff(440); cf.setResonance(0.7); });
    const peaky = await renderSaw((cf) => { cf.setCutoff(440); cf.setResonance(12); });
    // A resonant peak at/above the cutoff raises broadband-relative energy there;
    // assert the high-Q render's centroid sits higher than the flat one.
    expect(spectralCentroid(peaky, SR)).toBeGreaterThan(spectralCentroid(flat, SR));
  });
});
