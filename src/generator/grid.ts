// The GRID: how long the pattern is, and where on it the read head lands.
//
// The first half of what Karst's `event_core` does (research §4a) — a tick
// folded into a pattern length — and the one part of it Loom had no equivalent
// for. Everything else in this directory is a DECISION taken at a position;
// this is what says which position that is.
//
// Pure in the strong sense: numbers in, numbers out. It knows nothing about
// meters, ticks or sessions. The caller decides what a "step" is and this
// counts them, which is what will let the same grid serve a stream running at
// quarters and one running at sixteenths without either of them being special.

/** How long the pattern is, before any displacement moves the head along it. */
export interface GridSpec {
  /** Bars before the pattern comes round again. 1..16. */
  repeats: number;
  /** A power-of-two multiplier ON that length: 0..3 ⇒ ×1, ×2, ×4, ×8.
   *
   *  A separate control rather than folding both into one 1..128 number,
   *  because they are different gestures. `repeats` is "how many bars is my
   *  phrase"; this is "and now take four times as long to get through it". One
   *  control would put 8 and 9 next to each other on the dial, and musically
   *  they are nowhere near. */
  pow2: number;
}

export const DEFAULT_GRID: GridSpec = { repeats: 1, pow2: 0 };

const MAX_REPEATS = 16;
const MAX_POW2 = 3;

/** Coerce anything — a save, a panel, a knob mid-drag — into a usable grid.
 *
 *  Every field is clamped rather than rejected. A pattern length is a divisor
 *  and a zero one produces a modulo by zero, which is NaN in every note start
 *  it touches: a voice whose start is NaN never reaches its gate-off and cannot
 *  be released by a stop. The same failure `finitePosition` exists to catch on
 *  the weave's side, and worth catching at the same kind of door. */
export function clampGrid(g: Partial<GridSpec> | null | undefined): GridSpec {
  if (!g) return { ...DEFAULT_GRID };
  const int = (v: unknown, lo: number, hi: number, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v))
      ? Math.max(lo, Math.min(hi, Math.round(v)))
      : fallback;
  return {
    repeats: int(g.repeats, 1, MAX_REPEATS, DEFAULT_GRID.repeats),
    pow2: int(g.pow2, 0, MAX_POW2, DEFAULT_GRID.pow2),
  };
}

/** How many BARS the pattern spans. */
export function patternBars(g: GridSpec): number {
  const c = clampGrid(g);
  return c.repeats * (1 << c.pow2);
}

/** How many STEPS the pattern spans, at whatever division the caller counts in.
 *
 *  At least one, always. A caller handing a division finer than a bar cannot
 *  produce zero here, but one handing a coarser one can — and a zero-length
 *  pattern is the modulo-by-zero above. */
export function patternSteps(g: GridSpec, stepsPerBar: number): number {
  if (!Number.isFinite(stepsPerBar) || stepsPerBar <= 0) return 1;
  return Math.max(1, Math.round(patternBars(g) * stepsPerBar));
}

/** Where the read head lands for an ABSOLUTE step. Always in [0, patternSteps).
 *
 *  Absolute, and that is the whole point. A head counted from where the lane
 *  last started would put bar 5 of a take somewhere different from bar 5 of the
 *  same take rendered offline — which is exactly the divergence the modulator
 *  kernels are kept pure to avoid, arriving by another road.
 *
 *  Floor-mod rather than `%`, so a negative step — a lane read before the
 *  transport's zero, which the look-ahead can genuinely ask for — folds to a
 *  real position instead of a negative index. */
export function readHead(step: number, g: GridSpec, stepsPerBar: number): number {
  const len = patternSteps(g, stepsPerBar);
  if (!Number.isFinite(step)) return 0;
  const s = Math.round(step);
  return ((s % len) + len) % len;
}
