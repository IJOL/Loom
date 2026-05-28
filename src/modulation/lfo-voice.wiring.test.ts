// src/modulation/lfo-voice.wiring.test.ts
// Layer-4: a free-running LFO connected to a gain via a depth bridge should
// produce audible oscillation. This catches breaks in the LFOVoice output
// path or the host's spawnVoice routing.

import { describe, it, expect } from 'vitest';
import { LFOVoice } from './lfo-voice';
import { makeDefaultLFO } from './types';
import { rms } from '../../test/dsp-asserts';

async function renderLfoIntoGain(rateHz: number, durSec: number, depth: number): Promise<Float32Array> {
  const SR = 44100;
  const ctx = new OfflineAudioContext(1, Math.round(SR * durSec), SR);

  // Source: silent DC at 0.5 amplitude. We modulate ITS gain via the LFO.
  const src = ctx.createConstantSource();
  src.offset.value = 0.5;
  const carrier = ctx.createGain();
  carrier.gain.value = 1.0;
  src.connect(carrier);
  carrier.connect(ctx.destination);
  src.start(0);

  const state = makeDefaultLFO('lfo1');
  state.rateHz = rateHz;
  state.bipolar = true;
  const lfo = new LFOVoice(ctx as unknown as AudioContext, state, () => 120);

  // Bridge: lfo.output → gain (depth) → carrier.gain
  const depthGain = ctx.createGain();
  depthGain.gain.value = depth;
  lfo.output.connect(depthGain);
  depthGain.connect(carrier.gain);

  lfo.trigger(0);

  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('LFOVoice wiring', () => {
  it('produces oscillation in the bridged gain when depth > 0', async () => {
    const buf = await renderLfoIntoGain(4, 0.5, 0.4);
    // The DC (0.5) is gain-modulated by ±0.4 — output should vary across
    // the buffer. Compare RMS of the first 50 ms (likely below the LFO peak)
    // to RMS of the whole buffer.
    const head = buf.subarray(0, Math.round(44100 * 0.05));
    expect(Math.abs(rms(buf) - rms(head))).toBeGreaterThan(0.01);
  });

  it('depth=0 leaves the carrier at its base value', async () => {
    const buf = await renderLfoIntoGain(4, 0.5, 0);
    // Buffer should be ≈ 0.5 throughout. Standard deviation tiny.
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    const mean = sum / buf.length;
    let varSum = 0;
    for (let i = 0; i < buf.length; i++) varSum += (buf[i] - mean) ** 2;
    const sd = Math.sqrt(varSum / buf.length);
    expect(sd).toBeLessThan(0.01);
  });

  it('higher rateHz produces more zero crossings around the carrier mean', async () => {
    const slow = await renderLfoIntoGain(2, 0.5, 0.4);
    const fast = await renderLfoIntoGain(20, 0.5, 0.4);
    const meanCrossings = (buf: Float32Array, mean: number) => {
      let c = 0;
      for (let i = 1; i < buf.length; i++) {
        if ((buf[i - 1] >= mean && buf[i] < mean) || (buf[i - 1] < mean && buf[i] >= mean)) c++;
      }
      return c;
    };
    expect(meanCrossings(fast, 0.5)).toBeGreaterThan(meanCrossings(slow, 0.5) * 4);
  });
});
