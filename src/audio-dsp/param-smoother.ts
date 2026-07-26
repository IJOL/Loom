// src/audio-dsp/param-smoother.ts
// Per-sample knob slew for LIVE param changes.
//
// A lane's params used to be read once, at trigger: turning the cutoff did
// nothing to a note already sounding. This class keeps a SECOND copy of the bag
// that chases the real one, so a voice can read its continuous params every
// sample and hear the knob under your hand.
//
// The slew is not decoration. Knob messages arrive in ~16 ms steps; on an
// amplitude param a step IS a signal discontinuity, i.e. an audible click. A
// one-pole ramp removes it, and turns a preset load into a sweep instead of a cut.
//
// Cost: only the params still in flight are walked. At rest the list is empty and
// tick() is one integer compare — the render path pays exactly what it paid before.
import type { ParamBag } from './types';

/** ~15 ms: long enough to kill the step, short enough that the knob still feels
 *  attached to your hand. */
const DEFAULT_TIME_CONSTANT_SEC = 0.015;

export class ParamSmoother {
  /** The smoothed bag. Mutated IN PLACE — consumers keep this object reference
   *  and read through it; it is never reassigned. */
  readonly values: ParamBag = {};
  private readonly targets: ParamBag = {};
  /** Ids still travelling toward their target. Empty ⇒ nothing to do. */
  private readonly active: string[] = [];
  private readonly coeff: number;

  constructor(sr: number, timeConstantSec: number = DEFAULT_TIME_CONSTANT_SEC) {
    this.coeff = Math.exp(-1 / Math.max(1, timeConstantSec * sr));
  }

  get moving(): boolean { return this.active.length > 0; }

  /** Seed the bag: every id lands on its value at once, no ramp. Boot and lane
   *  construction go through here — a ramp from nothing would be a fade-in. */
  reset(patch: ParamBag): void {
    for (const id in patch) {
      this.values[id] = patch[id];
      this.targets[id] = patch[id];
    }
    this.active.length = 0;
  }

  /** Point one or more params at a new value. An id never seen before lands
   *  instantly (it has no previous value to ramp FROM); a known id starts a ramp. */
  setTargets(patch: ParamBag): void {
    for (const id in patch) {
      const v = patch[id];
      this.targets[id] = v;
      if (!(id in this.values)) { this.values[id] = v; continue; }
      if (this.values[id] === v) continue;
      if (this.active.indexOf(id) < 0) this.active.push(id);
    }
  }

  /** Advance every in-flight param one sample. Returns true when at least one
   *  moved, so callers can invalidate derived caches only when they must. */
  tick(): boolean {
    const n = this.active.length;
    if (n === 0) return false;
    // Walk backwards so splicing a converged id doesn't skip its neighbour.
    for (let i = n - 1; i >= 0; i--) {
      const id = this.active[i];
      const target = this.targets[id];
      const next = target + (this.values[id] - target) * this.coeff;
      // An exponential approach never arrives, so land it once the remaining
      // distance stops mattering — otherwise the id never leaves `active` and the
      // "zero cost at rest" guarantee is lost.
      if (Math.abs(target - next) <= Math.abs(target) * 1e-5 + 1e-7) {
        this.values[id] = target;
        this.active.splice(i, 1);
      } else {
        this.values[id] = next;
      }
    }
    return true;
  }
}
