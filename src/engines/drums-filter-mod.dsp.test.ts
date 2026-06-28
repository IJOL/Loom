import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

async function renderWithDetune(detuneCents: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new DrumsWorkletEngine();
  eng.setSharedFx(fx); eng.setBusStrip(busStrip); eng.setOutputTarget(busStrip.input);
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);              // base dark
  const det = eng.getSharedAudioParams().get('filter.cutoff')!;  // → detune
  det.value = detuneCents;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

describe('DrumsWorkletEngine — cutoff modulation routes to detune (audible)', () => {
  it('a positive cutoff detune opens the filter (brighter)', async () => {
    const dark   = await renderWithDetune(0);     // 300 Hz
    const bright = await renderWithDetune(4800);   // 300·2^4 = 4800 Hz
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });
});
