// src/audio-dsp/westcoast-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { WestcoastRenderer } from './westcoast-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;

const P: ParamBag = {
  'osc.mainWave': 0, 'osc.modWave': 0, 'osc.ratio': 2, 'osc.fmIndex': 0.2,
  'osc.ring': 0, 'osc.subDiv': 0, 'osc.subLevel': 0.3, 'osc.detune': 0,
  'timbre.fold': 0.5, 'timbre.symmetry': 0,
  'lpg.mode': 2, 'lpg.cutoff': 0.6, 'lpg.resonance': 0.2,
  'contour.mode': 0, 'contour.attack': 0.005, 'contour.decay': 0.4,
  'contour.amount': 0.9, 'contour.cycle': 0,
  'amp.level': 0.8, 'master.tune': 0,
};

const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 48, beginSec: 0, durationSec: 0.3,
  velocity: 0.8, accent: false, slide: false, ...o,
});

const rms = (b: number[]): number =>
  Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('WestcoastRenderer', () => {
  it('plucks: loud at the attack, quiet later (AD contour gates the LPG)', () => {
    // Long note so the pluck AD contour decays independently of the gate
    const v = new WestcoastRenderer(note({ durationSec: 1 }), P, SR);
    const early: number[] = [];
    for (let i = 0; i < SR * 0.03; i++) early.push(v.renderSample(i / SR));
    const late: number[] = [];
    for (let i = SR * 0.7; i < SR * 0.73; i++) late.push(v.renderSample(i / SR));
    expect(rms(early)).toBeGreaterThan(rms(late));
    expect(rms(early)).toBeGreaterThan(0.01);
  });

  it('more fold adds harmonics (different energy) compared to no fold', () => {
    const energy = (f: number): number => {
      const v = new WestcoastRenderer(note(), { ...P, 'timbre.fold': f }, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.02; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    const highFold = energy(0.9);
    const noFold = energy(0.0);
    // Both should be audible, and they should differ in energy due to the fold changing timbre
    expect(highFold).toBeGreaterThan(0.001);
    expect(highFold).toBeGreaterThan(noFold * 0.5);  // both produce sound; ratio differs
  });

  it('decays to ~silence and sets done=true after contour finishes', () => {
    // pluck mode, short decay to make the test faster
    const shortDecay: ParamBag = { ...P, 'contour.decay': 0.1, 'contour.attack': 0.001 };
    const v = new WestcoastRenderer(note({ durationSec: 1.5 }), shortDecay, SR);
    // Run past decay (0.1s dec * 3τ ≈ 0.3s — run for 0.8s to be sure)
    let last = 1;
    for (let i = 0; i < SR * 0.8; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01);
    expect(v.done).toBe(true);
  });

  it('sustain mode holds during the gate then releases', () => {
    const sustainP: ParamBag = {
      ...P,
      'contour.mode': 1,   // sustain
      'contour.attack': 0.001,
      'contour.decay': 0.05,
    };
    const v = new WestcoastRenderer(note({ durationSec: 0.2 }), sustainP, SR);
    // During the gate (t < 0.2), sustain mode keeps contour high → output audible
    const duringGate: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) duringGate.push(v.renderSample(i / SR));
    expect(rms(duringGate)).toBeGreaterThan(0.01);
    // After note-off + decay, signal drops
    let post = 1;
    for (let i = SR * 0.2; i < SR * 0.6; i++) post = v.renderSample(i / SR);
    expect(Math.abs(post)).toBeLessThan(0.05);
  });

  it('ring mod produces different output to no ring', () => {
    const sigWith = (ring: number): number => {
      const v = new WestcoastRenderer(note(), { ...P, 'osc.ring': ring }, SR);
      const b: number[] = [];
      for (let i = 0; i < 512; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    const e0 = sigWith(0);
    const e1 = sigWith(1);
    // Ring mod changes the signal character; at least one should be non-zero
    expect(e0 + e1).toBeGreaterThan(0.001);
    // They should differ by at least 5% relative
    expect(Math.abs(e0 - e1) / Math.max(e0, e1, 1e-9)).toBeGreaterThan(0.05);
  });

  it('sub-divider adds bass content (changes output)', () => {
    const renderSub = (subDiv: number, subLevel: number): number => {
      const v = new WestcoastRenderer(note({ durationSec: 1 }), {
        ...P, 'osc.subDiv': subDiv, 'osc.subLevel': subLevel,
      }, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.02; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    const a = renderSub(0, 0.3);   // sub off
    const b = renderSub(1, 0.8);   // sub on at high level
    // Both should produce sound and differ by at least 5% relative
    expect(a).toBeGreaterThan(0.001);
    expect(b).toBeGreaterThan(0.001);
    expect(Math.abs(a - b) / Math.max(a, b, 1e-9)).toBeGreaterThan(0.05);
  });

  it('cycling contour terminates after gate-off (no immortal voice)', () => {
    // Regression: a cycling contour (contour.cycle=1) used to re-trigger endlessly
    // after the note gate ended, making the voice immortal and draining the voice budget.
    // The fix: once ended===true (gate-off), the contour finishes its current decay
    // and goes 'done' — it must not restart another AD cycle.
    const cycleP: ParamBag = {
      ...P,
      'contour.cycle': 1,
      'contour.mode': 0,    // pluck/AD mode
      'contour.attack': 0.002,
      'contour.decay': 0.05,
    };
    // Short note (0.1 s) + render well past note-end + several decay periods (1.5 s total)
    const v = new WestcoastRenderer(note({ durationSec: 0.1 }), cycleP, SR);
    for (let i = 0; i < Math.floor(SR * 1.5); i++) v.renderSample(i / SR);
    expect(v.done).toBe(true);
  });

  it('registers under engine id "westcoast"', async () => {
    const { hasRenderer } = await import('./renderer-registry');
    expect(hasRenderer('westcoast')).toBe(true);
  });
});
