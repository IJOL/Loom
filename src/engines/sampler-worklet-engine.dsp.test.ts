// DSP test: proves the SamplerWorkletEngine's ChannelFilter is spliced on the
// RAW dry mix BEFORE the lane InsertChain + bus EQ.
// The real SamplerWorkletNode is mocked (worklet doesn't run under Vitest);
// instead we inject a sawtooth directly into the filter input node via
// eng.getChannelFilterInputForTest() — the same seam used by the drums test.
import { describe, it, expect, vi } from 'vitest';
import '../../test/setup';

vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    constructor(public ctx: any) {}
    private _dry: AudioNode | null = null;
    connectDry(n: AudioNode) { this._dry = n; }
    connectSend() {}
    loadSample() {} hasSample() { return false; }
    spawn() {} silenceAll() {} disconnect() {}
    get dry() { return this._dry; }
  },
}));

import { SamplerWorkletEngine } from './sampler-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

async function renderSampler(cutoff: number, eqHighDb: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new SamplerWorkletEngine();
  eng.setSharedFx(fx);
  eng.setOutputTarget(busStrip.input);           // dry → filter → busStrip.input
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);   // builds node + filter
  eng.setBaseValue('filter.cutoff', cutoff);
  busStrip.setEqHigh(eqHighDb);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

describe('SamplerWorkletEngine — channel filter placement (DSP)', () => {
  it('a low cutoff darkens the dry output', async () => {
    const open = await renderSampler(20000, 0);
    const dark = await renderSampler(300, 0);
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.6);
  });

  it('the filter sits BEFORE the bus EQ (still dark with the high-shelf boosted)', async () => {
    const open = await renderSampler(20000, 18);
    const dark = await renderSampler(300, 18);
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.7);
  });
});
