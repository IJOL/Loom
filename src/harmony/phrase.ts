// Where a bar sits in the phrase, and what that means for what it plays.
//
// This is the piece the part renderers were missing, and its absence is what
// "super estático" measured as: a comp over four bars put a chord on every
// eighth of every bar, so the four bars came out identical apart from which
// chord they spelled. 96 notes on a perfectly regular grid. A player does not
// do that for two bars, let alone four.
//
// What is missing there is not material — it is knowing what NOT to play. An
// arrangement is as much the holes as the notes, and where the holes go is
// decided by position in the phrase: the first bar states the harmony, the
// middle ones get out of the way, the last one turns round and hands back to
// the top.
//
// Pure, and deliberately expressed as a FLOOR on metric weight rather than as
// patterns of its own. The style already says how this music comps; the phrase
// only says how much of that to use here. Inventing separate rhythms per bar
// would be a second rhythm system arguing with the first.

import { metricWeight } from '../weave/metric-weight';

export interface PhrasePlace {
  /** 0-based bar within the phrase. */
  bar: number;
  /** How many bars the phrase runs to. */
  bars: number;
}

/** A phrase shorter than this has no middle and no turn — every bar is the
 *  opening. Shaping a two-bar loop would leave it with one bar of music. */
const SHORTEST_SHAPED = 3;

/** What the opening bar keeps: everything. It is where the harmony is stated,
 *  and a chord change nobody hears clearly is a chord change that did not
 *  happen. */
const FLOOR_OPEN = 0;

/** What the middle bars keep.
 *
 *  Above 0.5 on purpose, because that is the weight of an ordinary offbeat: the
 *  common comping shapes put half their hits there, so this is the threshold
 *  that actually removes something. At 0.45 — under it — a bar of eighths keeps
 *  all eight and nothing changes, which is the version of this that would have
 *  looked implemented and done nothing. */
const FLOOR_MIDDLE = 0.6;

/** The turnaround keeps EVERYTHING it plays — the same floor as the opening.
 *
 *  Its shape comes from the hole, not from thinning: silent for the first half,
 *  then back at full for the second. That is what a turn is, and stacking the
 *  middle-bar floor on top of the hole is what it must not be — measured on a
 *  real loop, the two together left the last bar coming back with two chords,
 *  which reads as the music running out of steam exactly where it should be
 *  pushing into the next lap. The hole and the thinning are two devices; only
 *  one belongs here. */
const FLOOR_TURN = FLOOR_OPEN;

export const isTurnaround = (p: PhrasePlace): boolean =>
  p.bars >= SHORTEST_SHAPED && p.bar === p.bars - 1;

const isOpening = (p: PhrasePlace): boolean => p.bar === 0 || p.bars < SHORTEST_SHAPED;

/** The metric-weight floor for this bar. A hit weaker than this does not play. */
export function phraseFloor(p: PhrasePlace): number {
  if (isOpening(p)) return FLOOR_OPEN;
  return isTurnaround(p) ? FLOOR_TURN : FLOOR_MIDDLE;
}

/** Does a hit at `tickInBar` survive this bar of the phrase?
 *
 *  Two questions, and the second only applies to the turn: is it strong enough,
 *  and — in the last bar — is it past the hole. The hole is the first HALF,
 *  derived from barTicks rather than fixed at eight steps, so a bar that is not
 *  sixteen steps long still has one. */
export function playsInBar(tickInBar: number, barTicks: number, p: PhrasePlace): boolean {
  if (metricWeight(tickInBar, barTicks) < phraseFloor(p)) return false;
  return !inHole(tickInBar, barTicks, p);
}

/** The hole alone, for a part whose IDENTITY is that it keeps running.
 *
 *  An arpeggio thinned to its strong positions is not a lighter arpeggio, it is
 *  a different part: what makes it an arpeggio is the unbroken stream. So it is
 *  spared the floor and given only the drop-out — which is the device a player
 *  would use on it anyway, and the one that costs it nothing the rest of the
 *  time. */
export function inHole(tickInBar: number, barTicks: number, p: PhrasePlace): boolean {
  return isTurnaround(p) && tickInBar < barTicks / 2;
}

/** The hits of a comping shape that survive this bar of the phrase — and NEVER
 *  an empty bar.
 *
 *  The floor alone cannot be trusted with that, and it shipped proving it. It
 *  is an absolute threshold sitting just above an ordinary offbeat, which is
 *  right for a shape with strong and weak positions and catastrophic for one
 *  made ENTIRELY of offbeats: garage and house comp on the offbeat and nothing
 *  else, all four hits weigh exactly 0.5, and the floor took all four. Two bars
 *  of silence in the middle of every phrase. `sustained` broke the other way —
 *  one hit per bar, and in the turnaround it falls inside the hole.
 *
 *  So the floor thins, and this guarantees it never erases: if nothing survives,
 *  the strongest hit does. That rule is not invented here — `applyDensity` has
 *  had it all along, in the same words: an empty bar reads as a dead lane rather
 *  than a sparse one, so the strongest hit always survives however far the knob
 *  goes down. The hole is waived with it, deliberately: a bar reduced to one
 *  note is already the sparsest statement available, and silencing that too
 *  would be the erasure this exists to prevent. */
export function survivingHits<T extends { stepOffset: number }>(
  hits: readonly T[], stepTicks: number, barTicks: number, p: PhrasePlace,
): T[] {
  const kept = hits.filter((h) => playsInBar(h.stepOffset * stepTicks, barTicks, p));
  if (kept.length > 0 || hits.length === 0) return kept;
  return [hits.reduce((best, h) => (
    metricWeight(h.stepOffset * stepTicks, barTicks)
      > metricWeight(best.stepOffset * stepTicks, barTicks) ? h : best
  ), hits[0])];
}
