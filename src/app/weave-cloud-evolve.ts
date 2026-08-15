// When a travelling CLOUD hands a corner over.
//
// A→B gets its moment for free: the position wraps, and `applyFlow` reports it.
// A square has no such moment — its lap is four legs, and the event that matters
// is arriving at a corner, which happens four times a lap and never shows up as
// a wrap. So the arrivals are found here instead, by watching the leg the dot is
// walking and noticing when it changes.
//
// One module and not two copies, because both tick sites need it — the clock in
// `weave-wiring` and the panel's own gesture in `panel-context` — and a square
// that evolved under one and not the other would look like the transport
// mattering to what a lane plays.

import type { LaneSelection } from '../weave/weave-state';
import type { WeaveLoopContext } from './weave-loops';
import { cloudLegAt } from '../weave/topology-cloud';
import { evolveCloudOnLeg } from './weave-loops';

/** Hand over one corner of every cloud lane that has just reached one.
 *
 *  Called AFTER the flow has moved the lanes: the leg is read from where each
 *  lane now is, against the leg it was on when this last ran.
 *
 *  Returns whether any corner actually changed, so a caller can invalidate the
 *  note sources it caches — a square whose material moved and whose cache did
 *  not is a lane that plays the old loop until something else happens to clear
 *  it. */
export function evolveCloudLanes(
  lanes: Record<string, LaneSelection | undefined>,
  laneIds: readonly string[],
  contextFor: (laneId: string) => WeaveLoopContext,
  seed: number,
): boolean {
  let changed = false;

  for (const laneId of laneIds) {
    const entry = lanes[laneId];
    const sel = entry?.weave;
    if (!entry || sel?.kind !== 'cloud') continue;

    // `t` is the lap and `x` is a coordinate on it. A selection the user built
    // by hand has no `t` yet, and falling back to `x` reads a sensible leg out
    // of it rather than parking every such lane on leg 0.
    const leg = cloudLegAt(sel.path, sel.t ?? sel.x);
    if (leg === entry.legAt) continue;

    // The FIRST sighting records where the lane is and draws nothing. A lane
    // loaded from a save, or one just switched to a cloud, has not travelled
    // anywhere yet — treating that as an arrival would re-deal a corner for
    // opening a session.
    const arrived = entry.legAt !== undefined;
    const next = arrived
      ? evolveCloudOnLeg(sel, contextFor(laneId), seed, laneId, leg, entry.trail)
      : null;

    lanes[laneId] = { ...entry, legAt: leg, ...(next ? { weave: next } : {}) };
    if (next) changed = true;
  }

  return changed;
}
