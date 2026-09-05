// SPDX-License-Identifier: AGPL-3.0-or-later
// Single-cycle wavetable primitives: the additive synthesis that turns a
// Fourier spec into a table, the interpolating read, and an oscillator that
// crossfades two tables — shaped as an `Osc`, so a UnisonStack stacks it like
// any other wave and hands it detune, spread, drift and the stack modes.
//
// The TABLES themselves stay in the plugin that owns them: a wave table is an
// engine's identity, and two engines that happen to want a sawtooth are not
// sharing an identity, they are sharing this arithmetic. Pure: no Web Audio,
// the sample rate is injected.

import type { Osc } from './unison';

/** Fourier coefficients of one cycle: `imag[k]` scales sin(k·θ) and `real[k]`
 *  cos(k·θ). Index 0 (DC) is ignored; `real` may be omitted. */
export interface WaveSpec { imag: Float32Array; real?: Float32Array }

/** Additively synthesise one single-cycle table of `n` samples from `spec`,
 *  peak-normalised to ±1 so tables of very different harmonic content sit at
 *  one level. The summation ORDER is pinned — k ascending, sine then cosine —
 *  because plugin parity renders are bit-compared against tables built here. */
export function synthWaveTable(spec: WaveSpec, n = 2048): Float32Array {
  const out = new Float32Array(n);
  const { imag, real } = spec;
  for (let i = 0; i < n; i++) {
    const ph = (i / n) * 2 * Math.PI;
    let s = 0;
    for (let k = 1; k < imag.length; k++) {
      s += imag[k] * Math.sin(k * ph);
      if (real && real[k]) s += real[k] * Math.cos(k * ph);
    }
    out[i] = s;
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  if (pk > 1e-9) for (let i = 0; i < n; i++) out[i] /= pk;
  return out;
}

/** Linear interpolation inside a single-cycle table. `phase` is 0..1: exactly
 *  1 wraps to 0, and the read past the last sample wraps to the first. Callers
 *  keep their phase in [0, 1) themselves; this is not a general modulo. */
export function sampleTable(tab: Float32Array, phase: number): number {
  const n = tab.length;
  const x = phase * n;
  let i = Math.floor(x);
  const f = x - i;
  if (i >= n) i -= n;
  const j = i + 1 === n ? 0 : i + 1;
  return tab[i] * (1 - f) + tab[j] * f;
}

/** Two tables read at one phase and crossfaded equal-power by a MORPH. */
export class WavetableOsc implements Osc {
  private phase = 0;
  /** The crossfade gains, recomputed only when the morph moves: two
   *  transcendentals per sample per copy is a real cost for a constant. */
  private gainA = 1;
  private gainB = 0;
  private morphRaw = 0;

  constructor(
    private readonly tA: Float32Array,
    private readonly tB: Float32Array,
    private readonly sr: number,
  ) {}

  /** One sample. The second argument is the MORPH — 0 is table A alone, 1 is
   *  table B alone — not a pulse width: the same licence SyncOsc takes with
   *  its ratio, and what lets a UnisonStack carry it without a second path. */
  update(freq: number, morph = 0): number {
    if (morph !== this.morphRaw) {
      this.morphRaw = morph;
      const m = morph < 0 ? 0 : morph > 1 ? 1 : morph;
      this.gainA = Math.cos(m * Math.PI * 0.5);
      this.gainB = Math.sin(m * Math.PI * 0.5);
    }
    const ph = this.phase;
    const v = this.gainB === 0
      ? sampleTable(this.tA, ph) * this.gainA
      : sampleTable(this.tA, ph) * this.gainA + sampleTable(this.tB, ph) * this.gainB;
    this.phase += freq / this.sr;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    return v;
  }
}
