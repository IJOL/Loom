// BAR MOD and LOOP MOD: the two wheels that move the read head off its repeat.
//
// Stage 6, and last for the reason the spec gives: evolution is worth nothing
// until the thing being evolved is already musical. It is also what finally
// makes a pool LONGER than the pattern reachable — stage 1 pinned that gap by
// test and named this as what fills it.
//
// ── Why this is not `harmony/cycle` ────────────────────────────────────────
//
// The spec said to reuse it, "or there will be two answers to how does this get
// long". Read closely, the two answer different questions and forcing the fit
// would cost the controls this stage exists to add.
//
// `harmony/cycle` is four NAMED wheels — figure, colour, register, density — on
// periods fixed in its source, turned on a few at a time by one `level` knob.
// It decides which of a follower's four choices differ this phrase. These two
// wheels are moduli the USER sets, and what they move is a position on a
// pattern. Mapping MULTIPLE, CYCLE and % onto a level knob would mean deleting
// them, and the full control surface is the scope that was agreed.
//
// What IS shared is the idea, and it is worth saying out loud so nobody reads
// this as a second implementation of the same thing: co-primality. Two wheels
// whose periods share no divisor stand in the same place again only after their
// PRODUCT of turns. Small wheels, long music — `harmony/cycle`'s own words, and
// the reason its periods are 4, 5, 7 and 3.
//
// Pure: numbers in, one number out.

export interface WheelSpec {
  /** How far ONE step of the wheel moves the head, in steps of the grid. */
  multiple: number;
  /** The wheel's period, in turns. 1 means it is NOT TURNING — every turn reads
   *  the same answer, which is what the generator did before this existed. The
   *  same convention `harmony/cycle` uses for a period of 1, deliberately. */
  cycle: number;
  /** 0..1 — how much of the displacement is actually applied. The one
   *  continuous control of the three, so a wheel can be faded in rather than
   *  switched on. */
  percent: number;
}

export const DEFAULT_WHEEL: WheelSpec = { multiple: 1, cycle: 1, percent: 0 };

const MAX_MULTIPLE = 16;
const MAX_CYCLE = 32;

export function clampWheel(w: Partial<WheelSpec> | null | undefined): WheelSpec {
  if (!w) return { ...DEFAULT_WHEEL };
  const int = (v: unknown, lo: number, hi: number, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v))
      ? Math.max(lo, Math.min(hi, Math.round(v)))
      : fallback;
  return {
    multiple: int(w.multiple, 1, MAX_MULTIPLE, DEFAULT_WHEEL.multiple),
    cycle: int(w.cycle, 1, MAX_CYCLE, DEFAULT_WHEEL.cycle),
    percent: (typeof w.percent === 'number' && Number.isFinite(w.percent))
      ? Math.max(0, Math.min(1, w.percent))
      : DEFAULT_WHEEL.percent,
  };
}

/** How far this wheel has moved after `turns` of it. */
function wheelAt(w: WheelSpec, turns: number): number {
  const cycle = Math.max(1, Math.round(w.cycle));
  if (cycle === 1 || w.percent === 0) return 0;
  const t = Math.floor(Number.isFinite(turns) ? turns : 0);
  // Floor-mod: a lane read before the transport's zero is a real question the
  // look-ahead asks, and a negative index here would displace backwards by an
  // amount that grows the further back you look.
  const at = ((t % cycle) + cycle) % cycle;
  return Math.round(at * w.multiple * w.percent);
}

export interface DisplaceAt {
  /** Where the head lands with no displacement at all. Bar Mod is read from
   *  THIS rather than from the displaced result, or the two would be defined in
   *  terms of each other. */
  head: number;
  /** The absolute step, for the lap count. */
  step: number;
  stepsPerBar: number;
  /** How many steps the whole pattern spans. */
  patternSteps: number;
}

/** How far the read head moves, in steps.
 *
 *  The two wheels turn on deliberately different clocks, and that is what gives
 *  them different characters rather than one being a slower copy of the other.
 *
 *  **BAR MOD turns once per BAR of the pattern**, counted off the folded head.
 *  So it repeats when the pattern does: within one pass, each bar reads from
 *  somewhere else, and the pattern's bars stop arriving in the material's own
 *  order. A rhythm you can learn.
 *
 *  Which means it has NOTHING TO TURN on a one-bar pattern — and the default
 *  grid is one bar, so out of the box its three controls do nothing until BARS
 *  is raised. That is coherent rather than broken (a wheel that turns per bar
 *  has one turn to make when there is one bar) and it is invisible unless
 *  somebody says so, which is what this paragraph and a test are for.
 *
 *  **LOOP MOD turns once per LAP of the pattern**, counted off the absolute
 *  step. So it never repeats within a pass: each time round, the whole pattern
 *  reads from further along. This is the one that reaches the tail of a pool
 *  longer than the pattern — the gap stage 1 pinned by test.
 *
 *  The same split CADENCE and CHORD already make: one folds with the pattern,
 *  one walks the song. */
export function displacement(bar: WheelSpec, loop: WheelSpec, at: DisplaceAt): number {
  const stepsPerBar = Math.max(1, at.stepsPerBar);
  const patternSteps = Math.max(1, at.patternSteps);
  return wheelAt(bar, Math.floor(at.head / stepsPerBar))
    + wheelAt(loop, Math.floor(at.step / patternSteps));
}
