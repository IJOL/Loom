// src/engines/drums-lfo-cutoff-mod.dsp.test.ts
// Objective reproduction of the reported bug: "the modular LFOs do NOT modulate
// the drumkit's cutoff". Unlike drums-filter-mod.dsp.test.ts (which writes the
// filter .detune BY HAND and only proves the biquad responds), this drives the
// REAL modulation path the UI uses: a shared LFO with a connection to
// `<laneId>.filter.cutoff`, wired by bindEngineModulators inside createVoice.
//
// A steady sawtooth is pushed through the channel filter; with the LFO at full
// depth on the cutoff the per-window spectral centroid must SWEEP over time
// (bright↔dark) far more than with no connection. If the LFO never reaches the
// filter, the centroid stays flat and this test fails — capturing the bug.

import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { clearLaneBindings } from '../modulation/voice-mod-binding';

const SR = 44100;
const LANE = 'drums-lane';

async function render(connectLfo: boolean): Promise<Float32Array> {
  clearLaneBindings();
  setCurrentLaneForVoice(LANE);

  const ctx = new OfflineAudioContext(1, SR, SR);   // 1 s → 4 LFO cycles at 4 Hz
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new DrumsWorkletEngine();
  eng.setSharedFx(fx); eng.setBusStrip(busStrip); eng.setOutputTarget(busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);           // dark base so the sweep is audible

  if (connectLfo) {
    // Exactly what the modulation UI stores when the user picks the CUTOFF knob
    // as the LFO destination: paramId = `${laneId}.filter.cutoff`.
    eng.modulators.setConnection('lfo1', { id: 'c1', paramId: `${LANE}.filter.cutoff`, depth: 1 });
  }

  // createVoice runs bindEngineModulators → lfo1.output → channelFilter.detune.
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

/** Peak-to-peak spread of the per-window (~50 ms) spectral centroid — how much
 *  the brightness sweeps over the render. A cutoff LFO makes this large. */
function centroidSpread(buf: Float32Array): number {
  const win = Math.floor(SR * 0.05);
  const cs: number[] = [];
  for (let i = 0; i + win <= buf.length; i += win) {
    cs.push(spectralCentroid(buf.subarray(i, i + win), SR));
  }
  return Math.max(...cs) - Math.min(...cs);
}

describe('DrumsWorkletEngine — a modular LFO modulates the channel cutoff (real bind path)', () => {
  it('an LFO connected to filter.cutoff sweeps the brightness over time', async () => {
    const dry = centroidSpread(await render(false));
    const wet = centroidSpread(await render(true));
    // The LFO sweep must reshape the brightness by a clear margin over the
    // unmodulated (flat) render.
    expect(wet).toBeGreaterThan(dry * 5);
  });
});
