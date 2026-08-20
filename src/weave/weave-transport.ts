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
  lanes: readonly {
    id: string;
    clips: readonly (SessionClip | null)[];
    /** A lane that ACCOMPANIES another is driven by this panel exactly as a
     *  weaving one is, and has to start with it. Without this Play skipped it —
     *  choosing a leader clears the lane's weave, so it stopped matching "has a
     *  weave selection" and fell out of the launch. The only way to hear it was
     *  to leave the panel and launch a scene by hand, which is precisely as
     *  strange as it sounds. */
    follow?: { leaderId: string };
  }[];
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
  // Weaving OR following: both are lanes this panel decides the notes of, and
  // a lane the panel drives has to start when the panel's Play does. Walked in
  // SESSION order rather than in the order the ids happen to come out of the
  // weave state, so the launches queue the way the grid reads.
  const weaving = new Set(weavingLaneIds(state, deps.lanes.map((l) => l.id)));
  for (const lane of deps.lanes) {
    if (!weaving.has(lane.id) && !lane.follow) continue;
    const row = clipRowForLane(lane.clips, deps.activeSceneIdx);
    // No clip anywhere ⇒ nothing to carry the lane, and it stays silent. That
    // is the same answer the scheduler gives: derived notes replace what a
    // playing clip CONTAINS, they do not replace the clip.
    if (row >= 0) deps.launchClipAt(lane.id, row);
  }
}

/** Play: launch what WEAVE is weaving, THEN start the clock — and survive the
 *  fact that launching a clip starts the clock too.
 *
 *  `launchClipAt` on a stopped transport arranges the lane and then presses
 *  Play itself, which is this very function. With even one weaving lane that is
 *  unbounded recursion: start → launch → start → launch → … until the stack
 *  gives out, and the clock never starts. Play went dead from the moment the
 *  transport was stopped, silently, with the button still looking armed.
 *
 *  The guard makes those nested presses no-ops, and that is not merely damage
 *  control — it is what makes the lanes start TOGETHER. While the clock is
 *  still stopped every lane takes `launchClipAt`'s idle branch and is queued at
 *  the same instant; let one nested call start the clock early and the lanes
 *  after it would be quantised to the next boundary instead, so the first lane
 *  would begin a bar before the rest. Arrange everything, then start once — the
 *  same order `launchSceneAt` follows, for the same reason. */
export function createWeaveAwareStart(deps: {
  /** Launch every weaving lane's carrier clip. */
  launchWeaving(): void;
  /** The real transport start, called exactly once per outermost press. */
  start(): void;
}): () => void {
  let launching = false;
  return () => {
    // A start that arrives from INSIDE the launch is that launch's own doing.
    // Returning is safe because the outer call has not reached `start()` yet
    // and always will.
    if (launching) return;
    launching = true;
    try {
      deps.launchWeaving();
    } finally {
      // Restored even if a lane's launch throws: one bad lane must not leave
      // the transport permanently unable to start, which is the failure this
      // whole function exists to end.
      launching = false;
    }
    deps.start();
  };
}
