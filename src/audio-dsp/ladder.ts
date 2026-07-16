// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from mpump's poly-synth.js — https://github.com/gdamdam/mpump
// Copyright (C) 2024-2026 gdamdam, licensed AGPL-3.0-or-later. Loom inherits
// that licence here; see LICENSE.
//
// Four-pole ladder filters, in two flavours. Both are the same topology — four
// one-pole stages inside a resonance feedback loop — and differ only in the
// nonlinearity each stage is pushed through, which is exactly where their
// character lives:
//
//   moog  — tanh, symmetric. The classic creamy 4-pole roll-off.
//   diode — an asymmetric clip (harder on the positive half). This is the 303's
//           bite: the asymmetry adds even harmonics a symmetric filter cannot.
//
// Loom's Svf (filter.ts) stays the "digital" model: cheaper, cleaner, and what
// every existing preset is voiced against.

/** Asymmetric soft clip: the diode ladder's whole personality. */
function diodeClip(v: number): number {
  return v > 0 ? Math.tanh(v * 1.2) : Math.tanh(v * 0.8);
}

const TWO_PI = Math.PI * 2;

/** A ladder's feedback reaches self-oscillation around 4, not 1. The public
 *  `res` is a 0..1 knob, so it is scaled here — pass it through raw and the
 *  filter barely resonates at all. */
const SELF_OSC_FEEDBACK = 4;

export type LadderModel = 'moog' | 'diode';

export class LadderFilter {
  // The four stage outputs. Plain fields, not an array: this runs per sample.
  private y0 = 0; private y1 = 0; private y2 = 0; private y3 = 0;

  constructor(private model: LadderModel, private sr: number) {}

  /** Clear the stages. A pooled voice must not inherit the last note's tail. */
  reset(): void { this.y0 = 0; this.y1 = 0; this.y2 = 0; this.y3 = 0; }

  /**
   * One sample through the ladder.
   * @param x         input sample
   * @param cutoffHz  cutoff in Hz (clamped below Nyquist)
   * @param res       resonance 0..1 — past ~0.9 it approaches self-oscillation
   */
  update(x: number, cutoffHz: number, res: number): number {
    const wc = (TWO_PI * Math.min(cutoffHz, this.sr * 0.45)) / this.sr;
    // Huovilainen's polynomial fit for the one-pole coefficient. It overshoots
    // (~1.16 near 0.45·sr), and a coefficient past unity means the filter stops
    // tracking the cutoff and audibly detunes — hence the clamp.
    const g = Math.min(
      1.0,
      0.9892 * wc - 0.4342 * wc * wc + 0.1381 * wc * wc * wc - 0.0202 * wc * wc * wc * wc,
    );

    const diode = this.model === 'diode';
    // The tiny input term keeps the feedback from latching at DC.
    const k = Math.max(0, res) * SELF_OSC_FEEDBACK * (diode ? 1.1 : 1);
    const fb = k * (this.y3 - x * 0.0005);
    // Moog saturates its feedback path; the diode ladder does not — its clipping
    // happens in the stages instead.
    const input = diode ? x - fb : x - Math.tanh(fb);

    const shape = diode ? diodeClip : Math.tanh;
    const s0 = this.y0 + g * (shape(input) - shape(this.y0));
    const s1 = this.y1 + g * (shape(s0) - shape(this.y1));
    const s2 = this.y2 + g * (shape(s1) - shape(this.y2));
    const s3 = this.y3 + g * (shape(s2) - shape(this.y3));

    // Flush denormals: they cost real time on the audio thread.
    this.y0 = Math.abs(s0) < 1e-15 ? 0 : s0;
    this.y1 = Math.abs(s1) < 1e-15 ? 0 : s1;
    this.y2 = Math.abs(s2) < 1e-15 ? 0 : s2;
    this.y3 = Math.abs(s3) < 1e-15 ? 0 : s3;

    // Four poles lose a lot of level; 3× puts it back near unity.
    return s3 * 3.0;
  }
}
