// src/audio-dsp/slot-smoother.ts
// Per-sample knob slew for LIVE param changes, addressed by SLOT.
//
// The same job as ParamSmoother and the same maths, with one difference that is
// the whole point of the params-by-index work: values live in a Float64Array
// indexed by a ParamIndex, not in an object keyed by dot-id. Renderers resolve
// their slots once and read `values[i]` per sample.
//
// ── Why there are two smoothers, and when there will be one ────────────────
// ParamSmoother is still alive for ONE consumer: the sampler's per-pad table
// (audio-worklet/sampler-processor.ts), which hands `sm.values` to a renderer
// as `setLivePad(... as unknown as LivePadParams)` — a CAST to a typed struct.
// A cast does not fail to compile when the object underneath becomes a
// Float64Array; it just reads garbage. Converting the sampler in this phase
// would mean touching a backend this phase excludes, with no parity reference
// to catch a mistake.
//
// So the duplication is deliberate and dated: it ends when the sampler backend
// moves (chunk 3, second half), and ParamSmoother goes with it. Do not add a
// third.
import type { ParamBag } from './types';
import type { ParamIndex } from './param-index';

/** ~15 ms: long enough to kill the step a 16 ms knob message would make, short
 *  enough that the knob still feels attached to your hand. */
const DEFAULT_TIME_CONSTANT_SEC = 0.015;

export class SlotSmoother {
  /** The smoothed values, by slot. Mutated IN PLACE — consumers keep this
   *  reference and read through it; it is never reassigned. */
  readonly values: Float64Array;
  private readonly targets: Float64Array;
  /** Slots still travelling toward their target. Empty ⇒ nothing to do. */
  private readonly active: number[] = [];
  /** Slots that have ever been written. A slot with no value has nothing to
   *  ramp FROM, so its first write lands instantly. */
  private readonly seen: Uint8Array;
  private readonly coeff: number;
  /** Set when a first-ever write landed instantly (it never enters `active`, so
   *  `tick()` would otherwise report "nothing moved" and a consumer caching
   *  anything derived from `values` would keep a stale value). */
  private landedInstantly = false;
  /** Ids with no slot, warned about once each: a manifest typo used to create a
   *  key nobody read, which is how it stayed invisible. */
  private readonly warned = new Set<string>();

  constructor(
    sr: number,
    private readonly index: ParamIndex,
    timeConstantSec: number = DEFAULT_TIME_CONSTANT_SEC,
  ) {
    this.values = new Float64Array(index.length);
    this.targets = new Float64Array(index.length);
    this.seen = new Uint8Array(index.length);
    this.coeff = Math.exp(-1 / Math.max(1, timeConstantSec * sr));
  }

  get moving(): boolean { return this.active.length > 0; }

  /** Resolve a dot-id to its slot, or -1. This is the ONLY place a name meets a
   *  number on the audio path: everything downstream is numeric. */
  private slotOf(id: string): number {
    const i = this.index.slot[id];
    if (i === undefined) {
      if (!this.warned.has(id)) {
        this.warned.add(id);
        console.warn(`[slot-smoother] no slot for param '${id}' — ignored`);
      }
      return -1;
    }
    return i;
  }

  /** Seed: every id lands on its value at once, no ramp. Boot and lane
   *  construction go through here — a ramp from nothing would be a fade-in. */
  reset(patch: ParamBag): void {
    for (const id in patch) {
      const v = patch[id];
      // A non-finite target would never satisfy the exit test in tick() (NaN
      // comparisons are always false), stranding the slot in `active` with a
      // corrupted value forever. Ignore it and keep the last good value.
      if (!Number.isFinite(v)) continue;
      const i = this.slotOf(id);
      if (i < 0) continue;
      this.values[i] = v;
      this.targets[i] = v;
      this.seen[i] = 1;
    }
    this.active.length = 0;
    this.landedInstantly = false;
  }

  /** Point one or more params at a new value. A slot never written before lands
   *  instantly; a known one starts a ramp. */
  setTargets(patch: ParamBag): void {
    for (const id in patch) {
      const v = patch[id];
      if (!Number.isFinite(v)) continue;
      const i = this.slotOf(id);
      if (i < 0) continue;
      this.targets[i] = v;
      if (!this.seen[i]) {
        this.values[i] = v;
        this.seen[i] = 1;
        this.landedInstantly = true;
        continue;
      }
      if (this.values[i] === v) continue;
      if (this.active.indexOf(i) < 0) this.active.push(i);
    }
  }

  /** Advance every in-flight slot one sample. Returns true when `values`
   *  CHANGED since the last tick — either a param ramped, or a first-ever write
   *  landed instantly. */
  tick(): boolean {
    const landed = this.landedInstantly;
    this.landedInstantly = false;
    const n = this.active.length;
    if (n === 0) return landed;
    // Walk backwards so swapping a converged slot in from the end cannot skip
    // its neighbour.
    for (let k = n - 1; k >= 0; k--) {
      const i = this.active[k];
      const target = this.targets[i];
      const next = target + (this.values[i] - target) * this.coeff;
      // An exponential approach never arrives, so land it once the remaining
      // distance stops mattering — otherwise the slot never leaves `active` and
      // the "zero cost at rest" guarantee is lost.
      if (Math.abs(target - next) <= Math.abs(target) * 1e-5 + 1e-7) {
        this.values[i] = target;
        // Swap-and-pop, not splice: splice allocates on the audio thread.
        this.active[k] = this.active[this.active.length - 1];
        this.active.pop();
      } else {
        this.values[i] = next;
      }
    }
    return true;
  }
}
