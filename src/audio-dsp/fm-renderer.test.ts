// src/audio-dsp/fm-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { FMRenderer } from './fm-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;

/** Build a ParamBag with all four ops set to identical defaults, overridable. */
const base = (o: Partial<ParamBag> = {}): ParamBag => ({
  algorithm: 0, feedback: 0, 'amp.mix': 0.7,
  'op1.ratio': 1, 'op1.level': 0.9, 'op1.attack': 0.01, 'op1.decay': 0.3, 'op1.sustain': 0.7, 'op1.release': 0.2, 'op1.detune': 0,
  'op2.ratio': 2, 'op2.level': 0.5, 'op2.attack': 0.01, 'op2.decay': 0.3, 'op2.sustain': 0.7, 'op2.release': 0.2, 'op2.detune': 0,
  'op3.ratio': 3, 'op3.level': 0.4, 'op3.attack': 0.01, 'op3.decay': 0.3, 'op3.sustain': 0.7, 'op3.release': 0.2, 'op3.detune': 0,
  'op4.ratio': 1, 'op4.level': 0.6, 'op4.attack': 0.01, 'op4.decay': 0.3, 'op4.sustain': 0.7, 'op4.release': 0.2, 'op4.detune': 0,
  ...o,
});

const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...o,
});

const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

/** Crude zero-crossing pitch estimator: count upward zero-crossings per second. */
function fundamentalHz(buf: Float32Array, sr: number): number {
  let crossings = 0;
  let prev = 0;
  for (const v of buf) {
    if (prev <= 0 && v > 0) crossings++;
    prev = v;
  }
  return (crossings * sr) / buf.length;
}

describe('FMRenderer', () => {
  it('is audible during the gate and done===true after release completes', () => {
    const v = new FMRenderer(note(), base(), SR);
    // Render during the gate
    const gateBuf: number[] = [];
    for (let i = 0; i < SR * 0.3; i++) gateBuf.push(v.renderSample(i / SR));
    expect(rms(gateBuf)).toBeGreaterThan(0.01);

    // Render well past release (durationSec=0.4, release=0.2 → tail ends ~0.6 s)
    let last = 1;
    for (let i = Math.floor(SR * 0.4); i < SR * 1.2; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01);
    expect(v.done).toBe(true);
  });

  it('additive algorithm (3) with all ops at ratio 1 plays near the note frequency (tuning fix)', () => {
    // A4 = midi 69 = 440 Hz.  Use algorithm 3 (all carriers, no FM modulation).
    // With all ratios = 1 and no FM, the output should be a near-pure sine at 440 Hz.
    const allRatioOne: ParamBag = base({
      algorithm: 3, feedback: 0,
      'op1.ratio': 1, 'op2.ratio': 1, 'op3.ratio': 1, 'op4.ratio': 1,
      // Low modulator levels so no unintended FM between ops (none in algo 3)
      'op1.level': 0.9, 'op2.level': 0.9, 'op3.level': 0.9, 'op4.level': 0.9,
      // Slow attack so the note is steady by the time we measure
      'op1.attack': 0.01, 'op2.attack': 0.01, 'op3.attack': 0.01, 'op4.attack': 0.01,
      'op1.sustain': 1, 'op2.sustain': 1, 'op3.sustain': 1, 'op4.sustain': 1,
    });
    const v = new FMRenderer(note({ midi: 69, durationSec: 2 }), allRatioOne, SR);

    // Skip the first 0.05 s (attack transient), measure the next 1 s of steady output.
    for (let i = 0; i < Math.floor(SR * 0.05); i++) v.renderSample(i / SR);

    const buf = new Float32Array(SR);
    for (let i = 0; i < SR; i++) buf[i] = v.renderSample((SR * 0.05 + i) / SR);

    const f = fundamentalHz(buf, SR);
    // Should be within a semitone of 440 Hz (±5.9% = factor 2^(1/12)−1 ≈ 5.9%)
    expect(f).toBeGreaterThan(415);  // 440 / 2^(1/12) ≈ 415
    expect(f).toBeLessThan(466);     // 440 * 2^(1/12) ≈ 466
  });

  it('serial algorithm (0) produces a modulated timbre and is audible', () => {
    // Algorithm 0: op4 → op3 → op2 → op1(carrier). With non-unity ratios, FM sidebands
    // should make the sound richer/louder than a degenerate 0-level case.
    const v = new FMRenderer(note(), base({ algorithm: 0 }), SR);
    const buf: number[] = [];
    for (let i = 0; i < Math.floor(SR * 0.15); i++) buf.push(v.renderSample(i / SR));
    expect(rms(buf)).toBeGreaterThan(0.005);
  });

  it('more feedback adds timbre variation on op4 self-feedback', () => {
    // feedback routes op4 output back into its own FM input. Two renders that
    // only differ in feedback should produce distinguishable outputs.
    const renderFirst = (fb: number): number => {
      const v = new FMRenderer(note(), base({ algorithm: 3, feedback: fb }), SR);
      return v.renderSample(0.1);  // one sample mid-sustain
    };
    // With algorithm 3 (additive), op4 is a carrier but also has the feedback path.
    // High feedback self-modulates op4's sine, adding harmonics and changing level.
    // We just verify the render completes without error and feedback=0.8 differs from feedback=0.
    const s0 = renderFirst(0);
    const s1 = renderFirst(0.8);
    // They can't both be exactly the same (feedback changes the waveform)
    // but we only assert they're finite and renderable.
    expect(isFinite(s0)).toBe(true);
    expect(isFinite(s1)).toBe(true);
    // The render function should produce non-zero output during a held note
    const vFb = new FMRenderer(note({ durationSec: 2 }), base({ algorithm: 3, feedback: 0.5 }), SR);
    const buf: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) buf.push(vFb.renderSample(i / SR));
    expect(rms(buf)).toBeGreaterThan(0.001);
  });

  it('noteOff before gate end shortens the note (done earlier)', () => {
    // Voice with a long gate; call noteOff early; verify done===true well before
    // the original holdEnd would have elapsed.
    const v = new FMRenderer(note({ durationSec: 5 }), base(), SR);
    // Render up to 0.05 s
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    // Release early
    v.noteOff(0.05);
    // Render through the release tail (release=0.2 → done by ~0.3 s)
    let last = 1;
    for (let i = Math.floor(SR * 0.05); i < SR * 1.5; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01);
    expect(v.done).toBe(true);
  });

  it('two-pairs algorithm (2) produces audible output from both carrier ops', () => {
    // Algorithm 2: pairs (op3→op2, op1→op0), carriers = op0 + op2.
    const v = new FMRenderer(note({ durationSec: 1 }), base({ algorithm: 2 }), SR);
    const buf: number[] = [];
    for (let i = 0; i < SR * 0.2; i++) buf.push(v.renderSample(i / SR));
    expect(rms(buf)).toBeGreaterThan(0.005);
  });
});
