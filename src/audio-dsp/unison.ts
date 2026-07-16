// SPDX-License-Identifier: AGPL-3.0-or-later
// Unison + analog drift adapted from mpump's poly-synth.js —
// https://github.com/gdamdam/mpump
// Copyright (C) 2024-2026 gdamdam, licensed AGPL-3.0-or-later. Loom inherits
// that licence here; see LICENSE.
//
// A supersaw is not two detuned oscillators — it is ONE oscillator stacked N
// times across a detune spread, beating against itself. This is that stack.
//
// Kept from mpump: each copy sits at its own place across the spread (pos = -1..+1),
// the 1/N^0.3 gain law, and the analog drift — a slow sine wander per copy at a
// random rate and a random phase, so no two copies are ever exactly in tune. That
// last part is what digital oscillators lack and analog ones cannot avoid.
//
// NOT kept: mpump's stereo spread (`pan = t * 0.8`). Loom's VoiceRenderer is mono
// by contract — renderSample returns a number — so there is nowhere to put a pan
// without changing every engine's signature. The detune beating, which is the
// part that actually makes the sound, is entirely mono and survives intact.
//
// Zero-allocation: update() runs per sample on the audio thread, so everything is
// preallocated in the constructor, the loops are index-based, and the detune
// ratios are cached — Math.pow per copy per sample is real cost, and its inputs
// only move when something is modulating them.

import { SawOsc, SquareOsc, TriOsc, SineOsc } from './osc';

/** `pw` is ignored by every wave but the square, where it is the duty cycle. */
export type Osc = { update(freq: number, pw?: number): number };

export function makeOsc(wave: number, sr: number): Osc {
  switch (wave) {
    case 1: return new SquareOsc(sr);
    case 2: return new TriOsc(sr);
    case 3: return new SineOsc(sr);
    default: return new SawOsc(sr);
  }
}

/** mpump's ceiling, and plenty — 7 copies is the classic supersaw. */
export const MAX_UNISON = 7;

const TWO_PI = Math.PI * 2;

/** Drift depth as a fraction of the note frequency (mpump's values). Bass notes
 *  wander less than high ones: the same number of cents is far more Hz down low,
 *  and a drifting bass just sounds out of tune. */
export const driftDepthFor = (freq: number): number => (freq < 200 ? 0.002 : 0.005);

export class UnisonStack {
  private readonly oscs: Osc[] = [];
  /** Where each copy sits across the spread, -1..+1. */
  private readonly pos: Float64Array;
  /** Frequency ratio per copy, cached against the inputs that produced it. */
  private readonly ratio: Float64Array;
  private cachedBase = NaN; private cachedSpread = NaN;
  private readonly driftPhase: Float64Array;
  private readonly driftRate: Float64Array;
  private readonly n: number;
  private readonly invSr: number;
  /** N copies must not be N times louder. */
  readonly gain: number;

  constructor(wave: number, count: number, sr: number) {
    const n = Math.max(1, Math.min(MAX_UNISON, Math.round(count)));
    this.n = n;
    this.invSr = 1 / sr;
    // mpump's law. It sits between no compensation (N^0) and a full incoherent
    // sqrt(N) (N^-0.5), so a detuned stack lands around N^0.2 — audibly fatter,
    // which is the whole point, but nowhere near N times louder. At N=1 it is
    // exactly 1, so a single voice is bit-identical to having no stack at all.
    this.gain = 1 / Math.pow(n, 0.3);
    this.pos = new Float64Array(n);
    this.ratio = new Float64Array(n);
    this.driftPhase = new Float64Array(n);
    this.driftRate = new Float64Array(n);
    for (let u = 0; u < n; u++) {
      this.oscs.push(makeOsc(wave, sr));
      // A lone copy sits dead centre — a spread needs something to spread.
      this.pos[u] = n === 1 ? 0 : (u / (n - 1)) * 2 - 1;
      // Random per copy, per note: the drift must not be a chorus, and two notes
      // must not wander in lockstep. Seeded fresh even when drift is off, because
      // an LFO can open it up mid-note.
      this.driftRate[u] = 0.15 + Math.random() * 0.2;   // 0.15..0.35 Hz
      this.driftPhase[u] = Math.random();
    }
  }

  /**
   * One sample of the whole stack, gain-compensated.
   * @param freq        note frequency (Hz)
   * @param pw          pulse width (bites on squares only)
   * @param baseCents   this oscillator's own detune
   * @param spreadCents half-width of the unison spread
   * @param driftAmt    drift depth as a fraction of freq; 0 skips it entirely
   */
  update(freq: number, pw: number, baseCents: number, spreadCents: number, driftAmt: number): number {
    // Nothing modulating the spread ⇒ these ratios are the same every sample.
    if (baseCents !== this.cachedBase || spreadCents !== this.cachedSpread) {
      for (let u = 0; u < this.n; u++) {
        this.ratio[u] = Math.pow(2, (baseCents + this.pos[u] * spreadCents) / 1200);
      }
      this.cachedBase = baseCents; this.cachedSpread = spreadCents;
    }
    let sum = 0;
    if (driftAmt > 0) {
      for (let u = 0; u < this.n; u++) {
        const d = 1 + Math.sin(TWO_PI * this.driftPhase[u]) * driftAmt;
        sum += this.oscs[u].update(freq * d * this.ratio[u], pw);
        this.driftPhase[u] = (this.driftPhase[u] + this.driftRate[u] * this.invSr) % 1;
      }
    } else {
      // The default path: no drift. At n=1 this is one oscillator at
      // freq * 2^(cents/1200) times a gain of exactly 1 — precisely what the
      // renderer computed before unison existed.
      for (let u = 0; u < this.n; u++) sum += this.oscs[u].update(freq * this.ratio[u], pw);
    }
    return sum * this.gain;
  }
}
