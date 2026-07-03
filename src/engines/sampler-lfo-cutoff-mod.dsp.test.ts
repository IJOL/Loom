// src/engines/sampler-lfo-cutoff-mod.dsp.test.ts
// Companion to drums-lfo-cutoff-mod: drives the REAL modular-LFO path on the
// Sampler engine (a shared LFO connected to `<laneId>.filter.cutoff`, wired by
// bindEngineModulators), not a hand-written detune. A steady sawtooth through
// the channel filter must have its brightness swept over time by the LFO.

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
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { clearLaneBindings } from '../modulation/voice-mod-binding';

const SR = 44100;
const LANE = 'sampler-lane';

async function render(connectLfo: boolean): Promise<Float32Array> {
  clearLaneBindings();
  setCurrentLaneForVoice(LANE);

  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new SamplerWorkletEngine();
  eng.setSharedFx(fx); eng.setOutputTarget(busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);

  if (connectLfo) {
    eng.modulators.setConnection('lfo1', { id: 'c1', paramId: `${LANE}.filter.cutoff`, depth: 1 });
  }

  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

function centroidSpread(buf: Float32Array): number {
  const win = Math.floor(SR * 0.05);
  const cs: number[] = [];
  for (let i = 0; i + win <= buf.length; i += win) {
    cs.push(spectralCentroid(buf.subarray(i, i + win), SR));
  }
  return Math.max(...cs) - Math.min(...cs);
}

describe('SamplerWorkletEngine — a modular LFO modulates the channel cutoff (real bind path)', () => {
  it('an LFO connected to filter.cutoff sweeps the brightness over time', async () => {
    const dry = centroidSpread(await render(false));
    const wet = centroidSpread(await render(true));
    expect(wet).toBeGreaterThan(dry * 5);
  });
});
