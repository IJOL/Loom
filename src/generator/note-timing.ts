// OFFSET and LENGTH: where exactly the hit lands, and how long it holds.
//
// Two of the spec's four streams, in one file because they answer one question
// between them — a note's shape in TIME — and share the same per-step formula.
// CADENCE decides whether there is a note at all and CHORD decides its pitch;
// everything left is here.
//
// Both are the identity at their defaults, so the generator sounds exactly as it
// did before this existed until a knob moves. That is not politeness: four
// stages of tests describe the un-nudged behaviour, and a stage that quietly
// re-timed them would have made every one of them a fresh judgement call.
//
// Pure: ticks in, ticks out.

import { patternValue, GOLDEN_PATTERN } from '../audio-dsp/pattern';
import { clamp01 } from '../audio-dsp/dsp-util';

export interface OffsetSpec {
  /** How far off its step a hit sits, in FRACTIONS of a step. -1..1.
   *
   *  Fractions rather than ticks, so the control means the same thing at every
   *  division: a nudge of 0.25 is a quarter of whatever a step currently is,
   *  and moving DIV does not silently rescale the groove. */
  amount: number;
  pattern: number;
  /** 0..1 — how far the per-step formula moves that nudge. This is the one that
   *  makes it a GROOVE rather than a shift: at 0 every hit moves by the same
   *  amount, which the ear reads as the whole lane being early or late. */
  mod: number;
}

export interface LengthSpec {
  /** How long a note is, as a multiple of its step.
   *
   *  1 fills the step exactly. Below it the line is detached; ABOVE it each
   *  note runs into the next, which on an engine that declares
   *  `"slide": "overlap"` is what makes it SLIDE — the 303's portamento has no
   *  flag of its own, it is inferred from one note still holding when the next
   *  starts. So this control is also the generator's slide control, on the
   *  engines that have one, without knowing that any of them exist. */
  length: number;
  pattern: number;
  mod: number;
}

export const DEFAULT_OFFSET: OffsetSpec = { amount: 0, pattern: GOLDEN_PATTERN, mod: 0 };
export const DEFAULT_LENGTH: LengthSpec = { length: 1, pattern: GOLDEN_PATTERN, mod: 0 };

/** A whole step either way is as far as the modulation reaches. Past that a hit
 *  changes which BEAT it is on, and a stream that could re-order the bar would
 *  be doing CADENCE's job badly rather than its own. */
const MOD_SPAN = 1;

const MIN_LENGTH = 0.05;
const MAX_LENGTH = 4;

const finite = (v: unknown, fallback: number) =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;

export function clampOffset(o: Partial<OffsetSpec> | null | undefined): OffsetSpec {
  if (!o) return { ...DEFAULT_OFFSET };
  return {
    amount: Math.max(-1, Math.min(1, finite(o.amount, 0))),
    pattern: finite(o.pattern, DEFAULT_OFFSET.pattern),
    mod: clamp01(finite(o.mod, 0)),
  };
}

export function clampLength(l: Partial<LengthSpec> | null | undefined): LengthSpec {
  if (!l) return { ...DEFAULT_LENGTH };
  return {
    length: Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, finite(l.length, 1))),
    pattern: finite(l.pattern, DEFAULT_LENGTH.pattern),
    mod: clamp01(finite(l.mod, 0)),
  };
}

/** How far off its step this hit sits, in TICKS. Signed: negative is early.
 *
 *  Capped at one step either way, after the modulation is added rather than
 *  before, so a big `amount` and a big `mod` cannot stack into a hit two steps
 *  from where the grid says it is. */
export function offsetTicks(spec: OffsetSpec, head: number, ticksPerStep: number): number {
  if (!(ticksPerStep > 0)) return 0;
  const swing = (patternValue(head, spec.pattern) - 0.5) * 2 * spec.mod * MOD_SPAN;
  const total = Math.max(-1, Math.min(1, spec.amount + swing));
  return Math.round(total * ticksPerStep);
}

/** How long this note holds, in TICKS. At least one — a note of zero length is
 *  a note that never gates on, which is silence wearing the shape of a hit. */
export function lengthTicks(spec: LengthSpec, head: number, ticksPerStep: number): number {
  if (!(ticksPerStep > 0)) return 1;
  const swing = (patternValue(head, spec.pattern) - 0.5) * 2 * spec.mod * MOD_SPAN;
  const factor = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, spec.length + swing));
  return Math.max(1, Math.round(factor * ticksPerStep));
}
