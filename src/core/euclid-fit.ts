// How long the clip has to be for every Euclidean cycle in it to come back
// round: the point where all the voices line up again with step 0 and the loop
// joins end to start. Pure arithmetic — the LCM of the active cycle lengths,
// rounded up to whole BARS, because a clip is measured in bars.
//
// A 5-step cycle over a 16-step bar phases: it only meets the barline again at
// step 80, so the clip has to be 5 bars for the pattern to repeat seamlessly.
// Two cycles at once (3 and 5) meet at 15 steps and the barline at 240 → 15
// bars. Which is exactly why this is capped: coprime cycles explode (5·7·11·13
// = 5005 steps → 5005 bars). Past the cap we stop growing and the loop simply
// cuts mid-cycle, the same way it did before any of this existed.

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

/** Nobody wants a 5005-bar drum clip out of one mistyped field. */
export const MAX_FIT_BARS = 32;

/**
 * Bars the clip needs so every cycle in `cycleSteps` finishes on the loop point.
 *
 * @param cycleSteps steps of each GENERATING row (rows with no hits don't count)
 * @param stepsPerBar the meter's 16th-notes per bar
 * @param minBars floor — the length the clip already had, so clearing the
 *        fields shrinks it back rather than crushing it to one bar
 */
export function euclidFitBars(
  cycleSteps: readonly number[],
  stepsPerBar: number,
  minBars: number,
): number {
  const perBar = Math.max(1, Math.round(stepsPerBar));
  const active = cycleSteps.filter((s) => Number.isFinite(s) && s >= 1).map((s) => Math.round(s));
  if (!active.length) return Math.max(1, minBars);

  const floor = Math.max(1, Math.round(minBars));
  const cycle = active.reduce(lcm, 1);
  // bars is never smaller than cycle/perBar, so this rules the runaway out
  // before the second multiply can overflow.
  if (!Number.isFinite(cycle) || cycle > MAX_FIT_BARS * perBar) return floor;
  const bars = lcm(cycle, perBar) / perBar;
  // Past the cap we DON'T grow: leaving the clip as it was beats turning one
  // mistyped field into a 35-bar pattern.
  return bars > MAX_FIT_BARS ? floor : Math.max(floor, bars);
}
