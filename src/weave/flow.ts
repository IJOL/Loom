// The master flow: one control that moves every lane's position at once, and
// how the lanes relate to each other while it does.
//
// This is the difference between a panel you operate and a panel that plays.
// Dragging one lane's fader is an edit; moving Flow is a performance gesture —
// and with a speed set, the scene keeps travelling on its own, which is the
// thing the whole design exists for. A weave that only moves when a hand is on
// it is a static scene with extra steps.
//
// Pure: no state, no clock, no DOM. The runtime decides WHEN; this decides WHERE.

/** How the lanes relate as the master flow moves.
 *
 *  Three, because they are three musical intentions and not three settings:
 *  everything turning over at once is a section change; lanes fanned out is a
 *  scene that is always partly in transition; free lanes are a scene the flow
 *  only nudges. */
export type DriftMode = 'together' | 'offset' | 'free';

/** A string off the panel ABI turned into one of the three. Anything else is
 *  'together', which is the mode that does the least surprising thing. */
export const asDrift = (v: string): DriftMode =>
  (v === 'offset' || v === 'free' ? v : 'together');

/** Fold a position into 0..1.
 *
 *  A value ALREADY in range comes back untouched. The modulo form alone turns
 *  0.3 into 0.30000000000000004, which is harmless arithmetically and not
 *  harmless everywhere else: at flow 0 in 'free' mode a scene the user placed by
 *  hand must come back exactly as it was, not a float's width away from it. */
const wrap01 = (v: number) => (v >= 0 && v < 1 ? v : ((v % 1) + 1) % 1);

/** Hold a position inside 0..1 by STOPPING at the ends.
 *
 *  The counterpart of `wrap01`, and the difference between the panel's two
 *  jobs. A lap that never ends folds; a fader a hand is holding has to have a
 *  far end, or dragging it all the way over lands you back where you started —
 *  which is the bug this pair exists to fix. */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where each lane's cross-fade should sit for this flow position.
 *
 *  `current` is what the lanes hold now, and it only matters in 'free' — the
 *  other two modes derive every position from the flow alone, which is what
 *  makes them feel like one control rather than n. */
export function flowPositions(
  flow: number, laneCount: number, drift: DriftMode, current: readonly number[] = [],
  /** True — the default — folds 1 back to 0, which is what a lap does. False
   *  stops at the ends, which is what a hand on the fader means. */
  wrap = true,
): number[] {
  if (laneCount <= 0) return [];
  const fold = wrap ? wrap01 : clamp01;
  const f = fold(flow);

  if (drift === 'together') return Array.from({ length: laneCount }, () => f);

  if (drift === 'offset') {
    // Fanned evenly across the journey. Never a full lap between the first lane
    // and the last, or the two would coincide and the fan would read as
    // 'together' with extra steps.
    const span = laneCount === 1 ? 0 : 1 / laneCount;
    return Array.from({ length: laneCount }, (_, i) => fold(f + i * span));
  }

  // 'free': the flow is a DELTA, not a position. Each lane keeps where it is and
  // moves by the same amount, so a scene the user has hand-placed stays placed
  // and the master control still means something.
  return Array.from({ length: laneCount }, (_, i) => fold((current[i] ?? 0) + f));
}

/** How far the flow has travelled after `bars`, given a journey of `barsPerLap`.
 *
 *  Returns 0..1 and wraps, so a scene left running keeps going round rather than
 *  arriving somewhere and stopping — which would be the static end state this
 *  panel exists to avoid.
 *
 *  A speed of 0 means "not moving", and that is the DEFAULT: the flow does
 *  nothing until asked, because a panel that starts travelling the moment it is
 *  opened would change a session nobody touched. */
export function flowAt(bars: number, barsPerLap: number): number {
  if (!Number.isFinite(barsPerLap) || barsPerLap <= 0) return 0;
  if (!Number.isFinite(bars)) return 0;
  return wrap01(bars / barsPerLap);
}

/** Move every lane's stored selection to where this flow puts it.
 *
 *  The ONE writer of a lane's position from the master control — the panel's
 *  gesture and the host's auto-advance both come through here, or the two would
 *  eventually disagree about what 'offset' means and the disagreement would only
 *  show as a scene that jumps when the transport starts.
 *
 *  Lanes with no selection are skipped rather than given a position: a lane the
 *  user never set up must not start weaving because the flow moved. `base` is
 *  what 'free' counts from — the positions as they were when the journey began,
 *  not as they are now, so repeated calls travel at a steady rate instead of
 *  accelerating.
 *
 *  Returns whether anything actually moved, so a caller running per tick can
 *  skip the invalidation when it did not. */
export function applyFlow(
  lanes: Record<string, { weave?: PositionedWeave | null; locked?: boolean } | undefined>,
  laneIds: readonly string[],
  flow: number,
  drift: DriftMode,
  base?: ReadonlyMap<string, number>,
  /** Called for a lane whose position WRAPPED past the end of its journey.
   *
   *  That is what "arrived" means once a speed is set: `flowAt` folds 1 back to
   *  0, so the position never lands on exactly 1 and a `>= 1` test would never
   *  fire. A lane that wrapped has completed a lap, which is where A→B re-hooks
   *  onto a fresh loop. */
  onWrap?: (laneId: string) => void,
  /** See flowPositions. With wrapping off no lane can ever wrap, so `onWrap`
   *  cannot fire — which is exactly what STATIC means. */
  wrap = true,
): boolean {
  const current = laneIds.map((id) => {
    const stored = lanes[id]?.weave;
    return base?.get(id) ?? (stored ? stored.x : 0);
  });
  const next = flowPositions(flow, laneIds.length, drift, current, wrap);

  let moved = false;
  laneIds.forEach((id, i) => {
    const entry = lanes[id];
    const sel = entry?.weave;
    // A LOCKED lane holds where it is. It still counts in the fan above, so
    // locking one lane does not re-space the others under it — the lock is a
    // lane sitting out the journey, not a lane leaving the scene.
    if (entry?.locked) return;
    if (!entry || !sel || sel.x === next[i]) return;
    // Backwards by more than half a lap is a WRAP, not a rewind: the journey
    // only ever goes forward, so a big drop is the far end folding round to the
    // near one. Half a lap is the threshold because a tick can legitimately move
    // a lane a long way — a fast speed, or a hand on the master fader — and
    // anything short of that is just travelling.
    const wrapped = next[i] < sel.x - 0.5;
    lanes[id] = { ...entry, weave: { ...sel, x: next[i] } };
    moved = true;
    // AFTER the write, never before. Called first, whatever the handler put in
    // the map was immediately overwritten by the line above — which still held
    // the entry captured at the top of this iteration. The re-hook happened and
    // vanished in the same tick.
    if (wrapped) onWrap?.(id);
  });
  return moved;
}

/** The shape `applyFlow` needs of a stored selection: a position, and whatever
 *  else it carries. Declared here rather than imported so this file stays pure
 *  arithmetic with no dependency on the panel's types. */
export interface PositionedWeave { x: number; [k: string]: unknown }
