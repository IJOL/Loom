// src/audio-dsp/comb.ts
// A comb filter: the signal plus a delayed copy of itself. Where the three
// existing circuits shape ONE corner, this one shapes a whole harmonic series
// at once -- the delayed copy reinforces every frequency whose period fits the
// delay and cancels the ones that fall between.
//
// Three taps, three genuinely different responses:
//   comb+   y = x + g*y[n-D]   peaks on EVERY harmonic of the tuning (a string)
//   comb-   y = x - g*y[n-D]   peaks on the ODD harmonics only (a stopped pipe)
//   combff  y = x + g*x[n-D]   no feedback at all: notches, and no ringing
//
// POS and NEG differ by a sign and sound nothing alike; cancelling the even
// harmonics is what makes a clarinet a clarinet.

import type { FilterTap } from './filter-kinds';

/** The lowest tuning the comb will accept. The delay line is sized for it once,
 *  per voice, and poly lanes are uncapped by design -- 30 Hz at 48 kHz is 1600
 *  samples, which is a buffer worth allocating; 5 Hz would be six times that for
 *  a pitch nobody plays. */
const MIN_TUNE_HZ = 30;

export class CombFilter {
  private readonly buf: Float32Array;
  private readonly size: number;
  private w = 0;

  constructor(private sr: number) {
    // +2 so the read index can never collide with the write index after rounding.
    this.size = Math.ceil(sr / MIN_TUNE_HZ) + 2;
    this.buf = new Float32Array(this.size);
  }

  /**
   * One sample.
   * @param tuneHz    the frequency the peaks are spaced by (the Cutoff knob)
   * @param feedback  0..1 how much comes back (the Resonance knob)
   */
  update(x: number, tuneHz: number, feedback: number, tap: FilterTap): number {
    const hz = tuneHz < MIN_TUNE_HZ ? MIN_TUNE_HZ : tuneHz > this.sr * 0.45 ? this.sr * 0.45 : tuneHz;
    const delay = Math.min(this.size - 1, Math.max(1, Math.round(this.sr / hz)));
    let r = this.w - delay;
    if (r < 0) r += this.size;
    const delayed = this.buf[r];

    // Strictly under 1: at 1 the loop never decays and the comb becomes an
    // oscillator that outlives the note.
    const g = feedback < 0 ? 0 : feedback > 0.97 ? 0.97 : feedback;

    let out: number;
    if (tap === 'combff') {
      // Feed-FORWARD: the delayed INPUT, not the delayed output. Nothing
      // circulates, so this one cannot ring however far the knob is pushed.
      out = x + g * delayed;
      this.buf[this.w] = x;
    } else {
      const s = tap === 'comb-' ? -1 : 1;
      out = x + s * g * delayed;
      this.buf[this.w] = out;
    }
    this.w = this.w + 1 >= this.size ? 0 : this.w + 1;
    // Two paths summed can reach 2x before the feedback even starts; halving
    // keeps a comb roughly level with the other three circuits.
    return out * 0.5;
  }
}
