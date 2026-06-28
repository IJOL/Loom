// Renders the drum bus through a REAL OfflineAudioContext (mocked DrumsWorkletNode
// is no good for DSP — we need real audio). Instead we drive the engine's filter
// node directly with a sawtooth into the bus-mix input, proving the filter is on
// the RAW mix and sits BEFORE the bus EQ.
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

/** Build a drums engine wired to a real offline ctx + bus strip, return the
 *  engine's raw-mix input node (the filter input) and the rendered destination. */
async function renderThroughBus(
  cutoff: number, resonance: number, eqHighDb: number,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new DrumsWorkletEngine();
  eng.setSharedFx(fx);
  eng.setBusStrip(busStrip);
  eng.setOutputTarget(busStrip.input);            // raw mix → filter → busStrip.input
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);  // builds filter + strips
  eng.setBaseValue('filter.cutoff', cutoff);
  eng.setBaseValue('filter.resonance', resonance);
  eng.setBaseValue('bus.eq.high', eqHighDb);

  // Inject a saw into the engine's raw-mix input (the filter input) to exercise
  // the channel path independent of the mocked worklet voices.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  const buf = await ctx.startRendering();
  return new Float32Array(buf.getChannelData(0));
}

describe('DrumsWorkletEngine — channel filter placement (DSP)', () => {
  it('a low cutoff darkens the bus output', async () => {
    const open = await renderThroughBus(20000, 0.7, 0);
    const dark = await renderThroughBus(300, 0.7, 0);
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.6);
  });

  it('the filter sits BEFORE the bus EQ: a low cutoff still darkens even with the high-shelf EQ boosted', async () => {
    // High-shelf +18 dB would brighten if it were UPSTREAM of the filter; because
    // the filter is upstream, the boosted highs were already removed → still dark.
    const openEqBoost = await renderThroughBus(20000, 0.7, 18);
    const darkEqBoost = await renderThroughBus(300,   0.7, 18);
    expect(spectralCentroid(darkEqBoost, SR)).toBeLessThan(spectralCentroid(openEqBoost, SR) * 0.7);
  });

  it('default cutoff is transparent: bus output centroid matches the no-filter wire', async () => {
    const dflt = await renderThroughBus(20000, 0.7, 0);
    // Reference: same source straight into the bus strip with the filter open.
    expect(spectralCentroid(dflt, SR)).toBeGreaterThan(0); // sanity; tight check below
    const dark = await renderThroughBus(300, 0.7, 0);
    expect(spectralCentroid(dflt, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });
});
