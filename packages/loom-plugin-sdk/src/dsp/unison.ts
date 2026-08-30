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
import { SyncOsc } from './sync-osc';

/** `pw` is ignored by every wave but the square, where it is the duty cycle. */
export type Osc = { update(freq: number, pw?: number): number };

/** An engine whose wave table does not share makeOsc's numbering hands the
 *  stack one of these instead of an index, and keeps its own meaning. */
export type OscFactory = (sr: number) => Osc;

export function makeOsc(wave: number, sr: number): Osc {
  switch (wave) {
    case 1: return new SquareOsc(sr);
    case 2: return new TriOsc(sr);
    case 3: return new SineOsc(sr);
    case 4: return new SyncOsc(sr);   // update()'s 2nd arg is the sync ratio, not pw
    default: return new SawOsc(sr);
  }
}

/** mpump's ceiling, and plenty — 7 copies is the classic supersaw. */
export const MAX_UNISON = 7;

/** A stack MODE places each copy on an interval before the detune spread fans
 *  them in cents — Vital's "unison stack" idea. Copy 0 is the ROOT in every
 *  mode, always at 0 semitones: the perceived pitch of a patch must not move
 *  when the mode does, and a 1-copy stack must be mode-proof by construction.
 *
 *  `semisFor(u, n)` rather than a flat table because one mode (Center Drop)
 *  is a function of WHERE the copy sits in the stack, not of its index alone. */
export interface UnisonMode {
  id: string;
  label: string;
  semisFor(u: number, n: number): number;
}

/** Semitones of harmonic k relative to the fundamental (k=1 → 0). */
const harmonicSemis = (k: number): number => 12 * Math.log2(k);

const cycle = (semis: number[]) => (u: number): number => semis[u % semis.length];

export const UNISON_MODES: UnisonMode[] = [
  // The classic supersaw: every copy at the root, only the spread separates
  // them. Mode 0 so an unaware caller gets exactly the pre-mode stack.
  { id: 'unison', label: 'Unison', semisFor: () => 0 },
  { id: 'octave', label: 'Octave', semisFor: cycle([0, 12]) },
  // The middle copy drops an octave — a sub under the spread. Needs a stack
  // wide enough to HAVE a middle that is not the root.
  { id: 'center-drop', label: 'Center Drop', semisFor: (u, n) => (n >= 3 && u === (n >> 1) ? -12 : 0) },
  { id: 'power-chord', label: 'Power Chord', semisFor: cycle([0, 7, 12]) },
  { id: 'major', label: 'Major', semisFor: cycle([0, 4, 7, 12]) },
  { id: 'minor', label: 'Minor', semisFor: cycle([0, 3, 7, 12]) },
  // The harmonic series itself: copy u sings partial u+1. Not equal-tempered
  // on purpose — 19.02, 27.86… is what makes it sound like an organ drawbar
  // rig instead of a chord.
  { id: 'harmonics', label: 'Harmonics', semisFor: u => harmonicSemis(u + 1) },
  { id: 'odd-harmonics', label: 'Odd Harmonics', semisFor: u => harmonicSemis(2 * u + 1) },
];

const TWO_PI = Math.PI * 2;

/** The stack's gain law — N copies must not be N times louder. It sits between
 *  no compensation (N^0) and full incoherent sqrt(N) (N^-0.5); at N=1 it is
 *  exactly 1. Exported so an engine that stacks something OTHER than an Osc
 *  (Karplus' strings) compensates by the same law instead of a second one. */
export const unisonGain = (n: number): number => 1 / Math.pow(n, 0.3);

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

  /** The mode's per-copy interval, in cents, fixed at construction: a mode
   *  change is a structural decision like the stack size, applied at the next
   *  trigger. */
  private readonly modeCents: Float64Array;

  constructor(wave: number | OscFactory, count: number, sr: number, mode = 0) {
    const n = Math.max(1, Math.min(MAX_UNISON, Math.round(count)));
    this.n = n;
    this.invSr = 1 / sr;
    const m = UNISON_MODES[Math.max(0, Math.min(UNISON_MODES.length - 1, Math.round(mode)))];
    this.modeCents = new Float64Array(n);
    for (let u = 0; u < n; u++) this.modeCents[u] = m.semisFor(u, n) * 100;
    // mpump's law, shared via unisonGain: a detuned stack lands around N^0.2 —
    // audibly fatter, which is the whole point, but nowhere near N times louder.
    this.gain = unisonGain(n);
    this.pos = new Float64Array(n);
    this.ratio = new Float64Array(n);
    this.driftPhase = new Float64Array(n);
    this.driftRate = new Float64Array(n);
    for (let u = 0; u < n; u++) {
      this.oscs.push(typeof wave === 'function' ? wave(sr) : makeOsc(wave, sr));
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
        this.ratio[u] = Math.pow(2, (baseCents + this.pos[u] * spreadCents + this.modeCents[u]) / 1200);
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
