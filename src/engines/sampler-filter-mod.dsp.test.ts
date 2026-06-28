import { describe, it, expect, vi } from 'vitest';
import '../../test/setup';
vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    constructor(public ctx: any) {}
    connectDry() {} connectSend() {} loadSample() {} hasSample() { return false; }
    spawn() {} silenceAll() {} disconnect() {}
  },
}));
import { SamplerWorkletEngine } from './sampler-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;
async function renderWithDetune(detuneCents: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new SamplerWorkletEngine();
  eng.setSharedFx(fx); eng.setOutputTarget(busStrip.input);
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);
  eng.getSharedAudioParams!().get('filter.cutoff')!.value = detuneCents;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

describe('SamplerWorkletEngine — cutoff modulation routes to detune', () => {
  it('a positive detune opens the filter (brighter)', async () => {
    const dark = await renderWithDetune(0);
    const bright = await renderWithDetune(4800);
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });
});
