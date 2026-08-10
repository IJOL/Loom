// Which lanes Play has to start, and which clip of each.
//
// WEAVE and the transport are one machine, and this is the half of that
// sentence Play needs. A weaving lane still plays a CLIP — the carrier the
// loops are folded into — so starting the clock without launching it leaves the
// panel contributing nothing and looking broken. Stop already stopped
// everything, which is why the asymmetry read as a bug rather than as a missing
// step.
//
// Pure: state in, ids out. No session mutation, no clock, no DOM.

import type { SessionClip } from '../session/session';
import type { WeaveState } from './weave-state';

/** The lanes with something to weave, in the SESSION's order.
 *
 *  Ordered by `laneIds` rather than by the state's own map, whose insertion
 *  order is whatever the user happened to click first. Two presses of Play must
 *  launch the same lanes in the same order or the scene starts differently each
 *  time.
 *
 *  A lane that holds a selection with no weave in it is skipped: that is what a
 *  lane looks like before its loops are chosen, and launching it would start a
 *  carrier clip that has no notes to give. */
export function weavingLaneIds(
  state: WeaveState, laneIds: readonly string[],
): string[] {
  return laneIds.filter((id) => !!state.lanes[id]?.weave);
}

/** The clip row Play should launch for a lane, or -1 when it has none.
 *
 *  The launched scene's row when this lane has a clip there, else its first
 *  clip. Following the scene is what keeps a lane started by Play in step with
 *  the lanes started from the grid — the same rule the panel's own per-lane
 *  play button follows, and it lives here so there is one answer rather than
 *  two that can drift.
 *
 *  -1 is a real answer rather than a failure: an empty lane is a lane with
 *  nothing to launch, and the caller skips it. */
export function clipRowForLane(
  clips: readonly (SessionClip | null)[], activeSceneIdx: number,
): number {
  if (clips[activeSceneIdx]) return activeSceneIdx;
  return clips.findIndex((c) => c !== null);
}

export interface WeaveLaunchDeps {
  lanes: readonly { id: string; clips: readonly (SessionClip | null)[] }[];
  /** The scene the grid has launched, which the weaving lanes fall in behind. */
  activeSceneIdx: number;
  /** The host's own launch, so a lane started by Play is queued and quantised
   *  exactly like one started by clicking its clip. */
  launchClipAt(laneId: string, row: number): void;
}

/** Launch the carrier clip of every weaving lane — what Play does before it
 *  starts the clock.
 *
 *  Lives here rather than inline at the call site so the orchestration is
 *  testable without a session, an audio graph or a DOM: the whole of it is
 *  "which lanes, which row, in what order", and all three are decisions worth
 *  pinning. */
export function launchWeavingLanes(state: WeaveState, deps: WeaveLaunchDeps): void {
  for (const id of weavingLaneIds(state, deps.lanes.map((l) => l.id))) {
    const lane = deps.lanes.find((l) => l.id === id);
    if (!lane) continue;
    const row = clipRowForLane(lane.clips, deps.activeSceneIdx);
    if (row >= 0) deps.launchClipAt(id, row);
  }
}
