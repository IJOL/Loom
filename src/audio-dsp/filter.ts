// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Strudel's dough.mjs (TwoPoleFilter) — https://codeberg.org/uzu/strudel
// Copyright (C) Strudel contributors, licensed AGPL-3.0-or-later. Loom inherits
// that licence here; see LICENSE.
//
// Two-pole state-variable filter (adapted from strudel dough.mjs TwoPoleFilter).
// `resonance` is a 0..1 damping parameter (NOT a biquad 0..22 Q): damping
// r = 0.5^((res+0.125)/0.125), so res=0 is heavily damped, res=1 is a strong but
// bounded resonance (voice peak ~2.8×), and res > ~1.5 goes near-undamped and
// blows up. Callers pass the 0..1 knob value straight through — no Q mapping.
// (Was a 0..22 biquad-Q scale before commit 241ec16; do not reintroduce it.)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export class Svf {
  private s0 = 0;   // bandpass state
  private s1 = 0;   // lowpass state
  lp = 0; bp = 0; hp = 0;
  constructor(private sr: number) {}
  update(input: number, cutoffHz: number, resonance: number): void {
    const res = Math.max(resonance, 0);
    const cutoff = Math.min(cutoffHz, this.sr * 0.45);
    let c = 2 * Math.sin((cutoff * Math.PI) / this.sr);
    c = clamp(c, 0, 1.14);
    const r = Math.pow(0.5, (res + 0.125) / 0.125);
    const mrc = 1 - r * c;
    this.s0 = mrc * this.s0 - c * this.s1 + c * input;   // bandpass
    this.s1 = mrc * this.s1 + c * this.s0;               // lowpass
    this.bp = this.s0; this.lp = this.s1; this.hp = input - this.lp - r * this.bp;
  }
}
