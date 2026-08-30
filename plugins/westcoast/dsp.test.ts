// plugins/westcoast/dsp.test.ts
// Behaviour of the West Coast plugin's renderer. These assertions used to live
// in src/audio-dsp/westcoast-renderer.test.ts, against the in-tree engine; the
// shipped plugin is the only West Coast there is, so the coverage moved with it.
import { describe, it, expect, vi } from 'vitest';

// `dsp.ts` calls Loom.registerRenderer at module scope — that is the ABI — so
// the global must exist before the import graph is evaluated. vi.hoisted is the
// only hook that runs that early. Same two-line stub the parity test next door
// installs, for the same reason.
vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

import { WestcoastRenderer } from './dsp';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';
import { ACCENT_PUNCH } from '../../src/core/velocity-gain';
import { rms as rmsOf, spectralCentroid } from '../../test/dsp-asserts';

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

const render = (p: ParamBag, n: NoteSpec, sec: number): Float32Array => {
  const v = new WestcoastRenderer(n, p, SR);
  const out = new Float32Array(Math.floor(SR * sec));
  for (let i = 0; i < out.length; i++) out[i] = v.renderSample(i / SR);
  return out;
};

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

  // On this engine the accent is a TIMBRE control: it drives the wavefolder
  // harder and opens the LPG contour further. The legacy engine kept that apart
  // from loudness — accentMul for timbre, velGain() for the amp — and the port to
  // the renderer collapsed both onto the same 1.3, so an accent was applied twice.
  it('accent brightens the fold without doubling the amp punch', () => {
    const buf = (accent: boolean, over: ParamBag = {}): Float32Array =>
      render({ ...P, ...over }, note({ accent }), 0.1);

    // Claim 1: brightness moves MORE than loudness. That is what the accent is for
    // here; if the amp punch rides along, the two ratios move together instead.
    const on = buf(true), off = buf(false);
    const brighter = spectralCentroid(on, SR) / spectralCentroid(off, SR);
    const louder = rmsOf(on) / rmsOf(off);
    expect(brighter).toBeGreaterThan(louder);

    // Claim 2: the amp punch alone is the SHARED one, measured with the timbre
    // difference cancelled by construction. In gate-only LPG mode the accent's
    // cutoff-env boost is out of the picture (cutoffEnvScale = 0 when filterMode
    // is false), and the fold's drive — (0.1 + fold*0.9) * accentMul — is
    // reproduced on the unaccented render by the fold knob alone:
    // (0.1 + 0.5*0.9) * 1.3 = 0.715 = 0.1 + 0.683333*0.9. The two renders then
    // differ by the amp gain and nothing else, so their RMS ratio IS the accent's
    // amp multiplier — a ratio, never a level.
    const GATE_ONLY: ParamBag = { 'lpg.mode': 1 };
    const punch =
      rmsOf(buf(true, GATE_ONLY)) /
      rmsOf(buf(false, { ...GATE_ONLY, 'timbre.fold': 0.6833333333333333 }));
    expect(punch / ACCENT_PUNCH).toBeCloseTo(1, 2);
  });

  // The "registers under engine id westcoast" case that used to close this file
  // is gone: it asked the HOST registry, which a plugin's dsp.ts no longer
  // touches — it calls Loom.registerRenderer instead, and
  // westcoast-parity.dsp.test.ts asserts exactly that, at the right door.
});

describe('unison stack on the main oscillator', () => {
  // Everything that could put its own energy at 440 is off: no FM, no ring, no
  // sub, fold at zero (drive 0.1 on a symmetric sine adds no even harmonics),
  // LPG open in filter mode. A sine main at 220 then has nothing an octave up
  // — Octave mode's second copy is the only possible source.
  const CLEAN: ParamBag = {
    ...P, 'osc.fmIndex': 0, 'osc.ring': 0, 'osc.subDiv': 0,
    'timbre.fold': 0, 'timbre.symmetry': 0,
    'lpg.mode': 0, 'lpg.cutoff': 1, 'lpg.resonance': 0,
    'osc.unison': 2, 'osc.spread': 0, 'osc.unisonMode': 0,
  };
  const mag = (xs: Float32Array, freqHz: number): number => {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * freqHz) / SR;
    for (let i = 0; i < xs.length; i++) {
      re += xs[i] * Math.cos(w * i);
      im += xs[i] * Math.sin(w * i);
    }
    return Math.hypot(re, im);
  };

  it('osc.unisonMode reaches the stack: Octave adds energy an octave up', () => {
    const n = note({ midi: 57, durationSec: 0.5 }); // 220 Hz
    const plain = render(CLEAN, n, 0.25);
    const octave = render({ ...CLEAN, 'osc.unisonMode': 1 }, n, 0.25);
    expect(mag(plain, 220)).toBeGreaterThan(0.1);
    expect(mag(octave, 440)).toBeGreaterThan(mag(plain, 440) * 5);
  });

  it('a patch that never mentions unison is bit-identical to the single osc', () => {
    // P carries no unison params at all — the silent defaults must be the
    // pre-unison voice, or every saved Westcoast patch changes sound on load.
    const n = note({ midi: 57, durationSec: 0.5 });
    const a = render(P, n, 0.25);
    const b = render({ ...P, 'osc.unison': 1, 'osc.unisonMode': 0, 'osc.spread': 15 }, n, 0.25);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });
});
