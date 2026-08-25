// CADENCE: does this step fire?
//
// A FLOOR on metric weight, not a pattern of its own — decided in the spec and
// it is the same argument `harmony/phrase` already made for itself. The bar
// already has a shape; strong positions survive first and weak ones fall first,
// so the knob thins and thickens a sense of the bar that exists rather than
// inventing a second one to argue with it. A free per-step decision is the arp
// pattern editor, and it stays there.
//
// Three things stack onto one threshold, and stacking is why they are floors:
// a hit has to clear all of them, so `Math.max` is the whole combination rule
// and there is no weighting to tune.
//
//   1. AMOUNT      — the knob. 0 is silence, 1 lets the whole division through.
//   2. PATTERN/MOD — the per-step variation, from the shared SDK formula.
//   3. PHRASE      — where this bar sits in the pattern, floored by
//                    `phraseFloor`: the opening states, the middle gets out of
//                    the way, the turn comes back.
//
// Pure: numbers in, a boolean out. No clock, no session.

import { clamp01 } from '../audio-dsp/dsp-util';
import { patternValue, GOLDEN_PATTERN } from '../audio-dsp/pattern';
import { metricWeight } from '../weave/metric-weight';
import { phraseFloor } from '../harmony/phrase';

export interface CadenceSpec {
  /** 0..1. The two ends are musical claims, not arbitrary: at 0 the lane is
   *  SILENT, and at 1 every step of the division fires. */
  amount: number;
  /** The multiplier in `frac(n × pattern + skew)`. */
  pattern: number;
  /** 0..1 — how far that formula moves `amount`, step by step. At 0 the rhythm
   *  is the same in every bar of the pattern. */
  mod: number;
  /** 0..1 — how much of the phrase's own floor is applied. */
  phrase: number;
}

/** Neutral, and deliberately so: it fires on every step, which is exactly what
 *  the generator did before this existed. The feature costs nothing until a
 *  knob is moved. */
export const DEFAULT_CADENCE: CadenceSpec = {
  amount: 1, pattern: GOLDEN_PATTERN, mod: 0, phrase: 0,
};

export function clampCadence(c: Partial<CadenceSpec> | null | undefined): CadenceSpec {
  if (!c) return { ...DEFAULT_CADENCE };
  const unit = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v)) ? clamp01(v) : fallback;
  return {
    amount: unit(c.amount, DEFAULT_CADENCE.amount),
    // NOT clamped to 0..1: a pattern above one is a perfectly good multiplier
    // and the formula folds it. Only rejected when it is not a number at all.
    pattern: (typeof c.pattern === 'number' && Number.isFinite(c.pattern))
      ? c.pattern : DEFAULT_CADENCE.pattern,
    mod: unit(c.mod, DEFAULT_CADENCE.mod),
    phrase: unit(c.phrase, DEFAULT_CADENCE.phrase),
  };
}

/** Where a step stands, for the decision to be made about it. */
export interface CadenceAt {
  /** The step's position ON THE PATTERN, from `readHead` — not its absolute
   *  step.
   *
   *  Absolute would mean the rhythm never repeats, and a rhythm that never
   *  repeats is not a groove; it would also make the grid decorative, since the
   *  pattern length would govern the pitches and nothing else. Moving the head
   *  off its repeat is what Bar Mod and Loop Mod are for, and they move THIS
   *  number — so every stream evolves together rather than each drifting on a
   *  clock of its own. */
  head: number;
  /** How many steps make a bar at this division. */
  stepsPerBar: number;
  /** Ticks per step, to place the head inside its bar. */
  ticksPerStep: number;
  barTicks: number;
}

/** The weight a hit must clear here. Exported for the tests, which have more to
 *  say about a number than about a boolean. */
export function cadenceThreshold(spec: CadenceSpec, at: CadenceAt): number {
  // The pattern moves the amount either way around where the knob is set, so a
  // mod at full depth still averages out at the knob's own value rather than
  // dragging the whole lane one way.
  const swing = (patternValue(at.head, spec.pattern) - 0.5) * spec.mod;
  return 1 - clamp01(spec.amount + swing);
}

/** Does this step fire?
 *
 *  STRICTLY greater, and the two musical floors depend on it. `metricWeight`'s
 *  strongest value is 1 and its weakest is 0.28, so `> 1` at amount 0 is
 *  silence and `> 0` at amount 1 is the whole division — the exact two ends the
 *  spec asks for, out of the comparison rather than out of a special case. */
export function cadenceFires(spec: CadenceSpec, at: CadenceAt, bars: number): boolean {
  const stepsPerBar = Math.max(1, at.stepsPerBar);
  const bar = Math.floor(at.head / stepsPerBar);
  const tickInBar = (at.head % stepsPerBar) * at.ticksPerStep;

  // Both are floors on the same quantity, so a hit clears both or neither. No
  // weighting to tune, which is the point of expressing the phrase this way
  // rather than as patterns of its own.
  //
  // The turnaround HOLE is deliberately not taken, though `phrase.inHole` is
  // right there. It silences the first half of the last bar outright, which is
  // a strong arrangement statement to impose on a lane whose phrase length the
  // user set by hand — and the spec asks for a floor. Available if it is ever
  // wanted; not dealt unasked.
  const floor = Math.max(
    cadenceThreshold(spec, at),
    phraseFloor({ bar, bars }) * spec.phrase,
  );
  return metricWeight(tickInBar, at.barTicks) > floor;
}
