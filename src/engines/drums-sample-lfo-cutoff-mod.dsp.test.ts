// src/engines/drums-sample-lfo-cutoff-mod.dsp.test.ts
// Reproduces the reported bug for a SAMPLE drumkit (DrumsWorkletEngine in
// kitMode 'sample', which delegates audio + UI to the embedded SamplerWorklet).
//
// In sample mode createVoice() calls the embedded sampler.createVoice() (which
// runs bindEngineModulators wiring the sampler's LFO → the sampler channel
// filter), and THEN the drums engine runs its OWN bindEngineModulators for the
// same laneId. That second call disposeAll()s the lane's engine binding — tearing
// down the sampler's freshly-made LFO→filter bridge — and rebuilds it from the
// DRUMS getSharedAudioParams, whose channelFilter is null in sample mode (no
// ensureWired). Net effect: the LFO stops reaching the cutoff.
//
// The UI in sample mode configures modulators on the EMBEDDED sampler's modHost,
// so that is where the connection is set here. With the LFO at full depth on the
// cutoff, the brightness of a sawtooth through the sampler channel filter must
// sweep over time — if the binding was torn down, it stays flat and this fails.

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
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { clearLaneBindings } from '../modulation/voice-mod-binding';

const SR = 44100;
const LANE = 'drums-sample-lane';

async function render(connectLfo: boolean): Promise<Float32Array> {
  clearLaneBindings();
  setCurrentLaneForVoice(LANE);

  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new DrumsWorkletEngine();
  eng.setKitMode('sample');
  eng.setSharedFx(fx); eng.setBusStrip(busStrip); eng.setOutputTarget(busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);           // sample mode routes this to the sampler filter

  const sampler = eng.getEmbeddedSampler();
  if (connectLfo) {
    // Sample-mode UI edits the embedded sampler's modHost.
    sampler.modulators.setConnection('lfo1', { id: 'c1', paramId: `${LANE}.filter.cutoff`, depth: 1 });
  }

  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(sampler.getChannelFilterInputForTest());
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

describe('DrumsWorkletEngine (sample kit) — a modular LFO modulates the channel cutoff', () => {
  it('an LFO connected to filter.cutoff sweeps the brightness over time', async () => {
    const dry = centroidSpread(await render(false));
    const wet = centroidSpread(await render(true));
    expect(wet).toBeGreaterThan(dry * 5);
  });
});
