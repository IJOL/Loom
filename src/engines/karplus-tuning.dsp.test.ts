// src/engines/karplus-tuning.dsp.test.ts
// Layer-3 DSP tests for the Karplus engine's *musical correctness*, on top of
// the shared battery. These guard the three failures that made the native
// DelayNode-feedback build "casi inusable":
//   1. Pitch collapsed to ~344 Hz (one render quantum) above C4.
//   2. Feedback/level build-up that clipped on overlapping notes.
//   3. The anti-coupling band-aid killed the string so damping had no audible
//      effect on decay.
// All assertions are relative (cents tolerance, ratios) per the test charter.

import { describe, it, expect } from 'vitest';
import { KarplusEngine } from './karplus';
import { OfflineAudioContext } from 'node-web-audio-api';
import { rms, peak, spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

// Autocorrelation fundamental estimate over a steady slice [fromSec, toSec).
function estimateFreq(buf: Float32Array, sr: number, fromSec: number, toSec: number): number {
  const a = Math.floor(fromSec * sr);
  const b = Math.min(buf.length, Math.floor(toSec * sr));
  const slice = buf.subarray(a, b);
  const n = slice.length;
  const minLag = Math.floor(sr / 2000); // up to 2 kHz
  const maxLag = Math.floor(sr / 40);   // down to 40 Hz
  let bestLag = -1;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += slice[i] * slice[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag > 0 ? sr / bestLag : 0;
}

function makeCtx(durSec: number): AudioContext {
  return new OfflineAudioContext(1, Math.round(durSec * SR), SR) as unknown as AudioContext;
}

async function renderSingle(
  setup: (e: KarplusEngine) => void,
  midi: number,
  gate: number,
  durSec: number,
): Promise<Float32Array> {
  const ctx = makeCtx(durSec);
  const engine = new KarplusEngine();
  setup(engine);
  const out = (ctx as unknown as { createGain(): GainNode }).createGain();
  out.connect((ctx as unknown as { destination: AudioNode }).destination);
  const voice = engine.createVoice(ctx, out);
  voice.trigger(midi, 0, { gateDuration: gate });
  const ab = await (ctx as unknown as { startRendering(): Promise<AudioBuffer> }).startRendering();
  return new Float32Array(ab.getChannelData(0));
}

// Fire `count` notes through ONE engine (polyhost: createVoice per note) to
// expose any cross-note coupling / runaway build-up.
async function renderSequence(
  setup: (e: KarplusEngine) => void,
  midi: number,
  count: number,
  spacingSec: number,
  gate: number,
  durSec: number,
): Promise<Float32Array> {
  const ctx = makeCtx(durSec);
  const engine = new KarplusEngine();
  setup(engine);
  const out = (ctx as unknown as { createGain(): GainNode }).createGain();
  out.connect((ctx as unknown as { destination: AudioNode }).destination);
  for (let i = 0; i < count; i++) {
    const voice = engine.createVoice(ctx, out);
    voice.trigger(midi, i * spacingSec, { gateDuration: gate });
  }
  const ab = await (ctx as unknown as { startRendering(): Promise<AudioBuffer> }).startRendering();
  return new Float32Array(ab.getChannelData(0));
}

const brightPluck = (e: KarplusEngine) => {
  e.setBaseValue('string.damping', 0.2);
  e.setBaseValue('string.brightness', 0.7);
  e.setBaseValue('amp.release', 1.0);
  e.setBaseValue('amp.level', 0.8);
};

describe('Karplus — pitch accuracy across the register', () => {
  // The whole point of the rewrite: notes above ~344 Hz must no longer
  // collapse to the render-quantum floor.
  for (const midi of [36, 48, 60, 69, 72, 84]) {
    it(`midi ${midi} is within 35 cents of its tempered pitch`, async () => {
      const expected = 440 * Math.pow(2, (midi - 69) / 12);
      const buf = await renderSingle(brightPluck, midi, 0.3, 0.6);
      const measured = estimateFreq(buf, SR, 0.05, 0.25);
      const cents = 1200 * Math.log2(measured / expected);
      expect(Math.abs(cents)).toBeLessThan(35);
    });
  }
});

describe('Karplus — no feedback build-up', () => {
  it('8 overlapping notes do not blow the peak past a single note', async () => {
    const single = await renderSingle(brightPluck, 48, 0.15, 1.0);
    const seq = await renderSequence(brightPluck, 48, 8, 0.2, 0.15, 3.0);
    // Decorrelated plucks sum sub-linearly; a feedback loop would runaway well
    // beyond 2x. Allow modest poly headroom but forbid runaway.
    expect(peak(seq)).toBeLessThan(peak(single) * 2.2);
  });
});

describe('Karplus — timbre controls are audible', () => {
  it('higher damping shortens the string decay', async () => {
    const ringy = await renderSingle((e) => {
      e.setBaseValue('string.damping', 0.05);
      e.setBaseValue('string.brightness', 0.6);
      e.setBaseValue('amp.release', 3.0);
      e.setBaseValue('amp.level', 0.8);
    }, 48, 1.5, 3.0);
    const dead = await renderSingle((e) => {
      e.setBaseValue('string.damping', 0.95);
      e.setBaseValue('string.brightness', 0.6);
      e.setBaseValue('amp.release', 3.0);
      e.setBaseValue('amp.level', 0.8);
    }, 48, 1.5, 3.0);
    // Measure energy in the 1.0–1.5 s tail: the ringy string should still be
    // sounding while the damped one has died.
    const tailA = Math.floor(1.0 * SR), tailB = Math.floor(1.5 * SR);
    const ringyTail = rms(ringy.subarray(tailA, tailB));
    const deadTail = rms(dead.subarray(tailA, tailB));
    expect(ringyTail).toBeGreaterThan(deadTail * 3);
  });

  it('higher brightness raises the spectral centroid', async () => {
    const dark = await renderSingle((e) => {
      e.setBaseValue('string.damping', 0.3);
      e.setBaseValue('string.brightness', 0.1);
      e.setBaseValue('amp.release', 1.0);
      e.setBaseValue('amp.level', 0.8);
    }, 48, 0.3, 0.6);
    const bright = await renderSingle((e) => {
      e.setBaseValue('string.damping', 0.3);
      e.setBaseValue('string.brightness', 0.95);
      e.setBaseValue('amp.release', 1.0);
      e.setBaseValue('amp.level', 0.8);
    }, 48, 0.3, 0.6);
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.3);
  });
});
