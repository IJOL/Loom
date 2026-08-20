// The three PanelContext members that answer "which lane does this one
// accompany".
//
// Their own file for the same reason panel-context-role.ts is: the list, the
// mark and the write are ONE control, and panel-context.ts is at its size limit
// besides. The write does something beyond the field — it clears the lane's
// weave — which reads as a unit here and as an unexplained side effect in a
// five-hundred-line switchboard.

import type { PanelChoice, PanelContext } from '@loom/plugin-sdk';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import type { SessionState, SessionLane } from '../session/session';
import { eligibleLeaders } from '../session/follow-eligible';
import { isHarmonic } from '../plugins/capabilities';

export interface FollowDepsUI {
  getState: () => SessionState;
  /** Drop the lane's weave selection. Follow and weave answer the same question
   *  and the host resolves follow first, so a selection left behind would be a
   *  control that visibly does nothing. */
  clearWeave: (laneId: string) => void;
  /** Put back the weave that `clearWeave` shelved, if there is one. Stopping
   *  following has to be the exact undo of starting it, or the control is a
   *  one-way door with no sign on it. */
  restoreWeave?: (laneId: string) => void;
  onWeaveChanged?: (laneId: string) => void;
  refresh: () => void;
  /** Read at call time, not captured: history is wired into the session AFTER
   *  this context is built, so a captured one would be undefined for the whole
   *  run. Same reason as roleMembers. */
  history: () => HistoryDeps | undefined;
}

export function followMembers(d: FollowDepsUI):
Pick<PanelContext, 'followChoices' | 'laneFollow' | 'setLaneFollow'> {
  return {
    followChoices: (laneId) => followChoices(d, laneId),
    laneFollow: (laneId) => laneOf(d, laneId)?.follow?.leaderId ?? null,
    setLaneFollow: (laneId, leaderId) => {
      const run = (): void => setLaneFollow(d, laneId, leaderId);
      const hd = d.history();
      if (hd) withUndo(hd, run); else run();
    },
  };
}

const laneOf = (d: FollowDepsUI, laneId: string): SessionLane | undefined =>
  d.getState().lanes.find((l) => l.id === laneId);

/** The lanes this one may accompany, "not following" first.
 *
 *  An EMPTY list is how this ABI says "do not show the control" — the same
 *  convention roleChoices uses. Two cases reach it: a percussion lane, which
 *  has no part to play and so cannot follow, and a session where no other lane
 *  is eligible. Both are questions that do not apply rather than pickers with
 *  nothing in them. */
export function followChoices(d: FollowDepsUI, laneId: string): PanelChoice[] {
  const lane = laneOf(d, laneId);
  if (!lane || !isHarmonic(lane.engineId)) return [];
  const leaders = eligibleLeaders(d.getState().lanes, laneId);
  if (leaders.length === 0) return [];
  return [
    { id: '', name: '— plays its own —' },
    ...leaders.map((l) => ({ id: l.id, name: `Follow ${l.name || l.id}` })),
  ];
}

/** Point a lane at a leader, or stop following with null. */
export function setLaneFollow(
  d: FollowDepsUI, laneId: string, leaderId: string | null,
): void {
  const lane = laneOf(d, laneId);
  if (!lane) return;
  if (leaderId === null || leaderId === '') {
    delete lane.follow;
    d.restoreWeave?.(laneId);
  } else {
    // Validated against the same list the picker offered, rather than trusted.
    // The panel is a PLUGIN: an id that parses but is not eligible would be a
    // lane following a drum machine, or a chain the scheduler has to walk.
    if (!eligibleLeaders(d.getState().lanes, laneId).some((l) => l.id === leaderId)) return;
    // The chords the user corrected belong to the leader they were corrected
    // AGAINST. Carrying them to a new leader would play one lane's harmony over
    // another's melody, which is worse than starting from the analysis again.
    lane.follow = { leaderId };
    d.clearWeave(laneId);
  }
  d.onWeaveChanged?.(laneId);
  d.refresh();
}
