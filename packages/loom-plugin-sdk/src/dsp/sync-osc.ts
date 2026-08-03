// SPDX-License-Identifier: AGPL-3.0-or-later
// Hard-sync oscillator, the topology adapted from mpump's poly-synth.js
// (https://github.com/gdamdam/mpump, AGPL-3.0-or-later; Loom inherits it, see
// LICENSE).
//
// A slave saw whose phase is FORCED back to zero every time the master
// completes a cycle. Two facts make it worth its own class:
//
//   - The master sets the PITCH: the reset happens once per master period, so
//     the output is periodic at the master frequency however fast the slave runs.
//   - The slave's ratio sets the TIMBRE: a higher ratio packs more (truncated)
//     saw teeth into each master period, adding upper harmonics — the bright,
//     tearing sweep you get by moving the ratio with an LFO or envelope, while
//     the pitch stays nailed. That decoupling is the whole reason hard sync
//     exists.
//
// The saw teeth are deliberately NOT band-limited: their edges are the harmonic
// content the effect is prized for. The RESET edge is the one that aliases hard,
// so only that discontinuity gets a polyBLEP correction.

function polyBlep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Ratio rails: 1 = no sync (a plain saw), 8 = a hard tearing lead. Continuous
 *  so an LFO/envelope on it is the sweep the effect is prized for. */
export const SYNC_RATIO_MIN = 1;
export const SYNC_RATIO_MAX = 8;

export class SyncOsc {
  private master = 0;   // 0..1, advances at the note frequency
  private slave = 0;    // advances at freq * ratio, reset when master wraps
  constructor(private sr: number) {}

  /** One sample. `freq` is the master (the pitch); the second argument is the
   *  sync ratio (the timbre) — named to satisfy the shared Osc interface, whose
   *  other members read it as pulse width. Ratios below 1 are clamped up. */
  update(freq: number, ratio = 2): number {
    const dt = freq / this.sr;               // master increment per sample
    const r = Math.max(1, ratio);
    const slaveDt = dt * r;

    this.master += dt;
    this.slave += slaveDt;

    if (this.master >= 1) {
      this.master -= 1;
      // Reset the slave to where a fractional master step lands it, so the sync
      // is sample-accurate rather than quantised to the block — the reset's
      // sub-sample position is what polyBLEP needs below.
      this.slave = this.master * r;
    }

    const p = this.slave % 1;
    let s = 2 * p - 1;                        // slave saw, edges intact
    // Band-limit the reset discontinuity only: it fires at the master rate, so
    // the correction uses the master increment, not the slave's.
    s -= polyBlep(this.master, dt);
    return Math.max(-1, Math.min(1, s));
  }
}
