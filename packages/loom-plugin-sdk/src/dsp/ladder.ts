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

/** Per unit of feedback, how much level to give back. Tuned so the raw ~2.9x
 *  duck at full resonance lands near 1.5x — thinner, but not ducked. */
const RES_MAKEUP = 0.12;

/** Which response to take out of the ladder.
 *
 *  A ladder is four one-pole lowpasses in a feedback loop, so its four stage
 *  outputs ARE LP1..LP4 of the loop input — and the other responses expand
 *  binomially straight out of them: (1-LP)^4 is a 4-pole highpass,
 *  LP^2*(1-LP)^2 a 2-pole bandpass. This is how real multimode ladders do it
 *  (the Oberheim Xpander/Matrix-12 derive their modes from exactly these taps);
 *  it is not the lowpass wearing a different label.
 *
 *  There is deliberately NO 'notch'. Measured, a notch tap here only nulls while
 *  the resonance is low: the ladder's own feedback fills the null as resonance
 *  rises, and on the diode at res 0.7 it inverts into a BUMP (0.46 at the cutoff
 *  against 0.25 three octaves below). A notch that becomes a peak is not a notch,
 *  and no honest makeup gain fixes a filled null — so the caller keeps the
 *  lowpass for that combination rather than being sold a lie. The Svf (filter.ts)
 *  is a true multimode and has a real notch; use DIG when you want one. */
export type LadderTap = 'lp' | 'hp' | 'bp';

// Per-tap makeup. The lowpass keeps its own historical expression untouched (see
// update), so these are chosen against it, from the measured raw tap gains at the
// engine's default resonance: the lowpass passband is 0.508 raw x its 3.36 makeup
// = 1.71, and the highpass passband is 0.771 raw, so 2.2 lands it on 1.70 — the
// same level, and switching LP<->HP is not a jump.
//
// The bandpass is NOT level-matched to those and should not be: its peak lands
// near 0.86, because a bandpass passes one band and throws the rest away. Making
// it as loud as the lowpass would mean lying about how much it removed.
const HP_MAKEUP = 2.2;
const BP_MAKEUP = 3.0;

/** Soft ceiling for the non-LP taps. Linear (slope 1) up to ~2.5, then bends
 *  toward a ~3.3 asymptote — so the passband is untouched and only the drive-fed
 *  transient peaks (which reached ~6) are folded back near unity. */
function softTap(x: number): number {
  const KNEE = 2.5;
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const over = a - KNEE;
  const shaped = KNEE + Math.tanh(over / KNEE) * KNEE * 0.8;
  return x < 0 ? -shaped : shaped;
}

export type LadderModel = 'moog' | 'diode';

export class LadderFilter {
  // The four stage outputs. Plain fields, not an array: this runs per sample.
  private y0 = 0; private y1 = 0; private y2 = 0; private y3 = 0;

  constructor(private model: LadderModel, private sr: number, private tap: LadderTap = 'lp') {}

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

    // The non-lowpass taps, binomial in the stages (see LadderTap). Both null at
    // DC by construction — their coefficients sum to zero — which is what makes
    // them real responses rather than a tinted lowpass.
    //
    // softTap tames the peaks the HP makes at high resonance + drive: its
    // coefficients reach 6 and its input carries the parallel drive (up to 1.8x),
    // so a level that is fine in the passband spikes to ~6 on transients. Left
    // raw, that peak crushes the master limiter. A gentle saturator passes the
    // useful level untouched and only bends the extremes — which is what an
    // analogue filter does when it clips, so the sound gains rather than loses.
    if (this.tap === 'hp') return softTap((input - 4 * s0 + 6 * s1 - 4 * s2 + s3) * HP_MAKEUP);  // (1-LP)^4
    if (this.tap === 'bp') return softTap((s1 - 2 * s2 + s3) * BP_MAKEUP);                       // LP^2*(1-LP)^2

    // Four poles lose a lot of level; 3× puts it back near unity.
    // The resonance term makes up part of what the feedback subtracts. Raw, a
    // ladder is ~2.9x quieter at full resonance than at none, which means
    // turning resonance up ducks the voice — and anything that raises Q, like a
    // 303's accent, comes out QUIETER than the note it is meant to punch. Half
    // makeup: the thinning stays (it is the character), the duck goes.
    return s3 * 3.0 * (1 + k * RES_MAKEUP);
  }
}
