// Which lanes a follower may be pointed at.
//
// Its own file, and pure, because the picker is not the only thing that needs
// the answer: the LOADER drops a leaderId it cannot resolve, and anything that
// OFFERS a leader must offer the same set the loader would keep. Two copies of
// this rule is how you get a dropdown offering a lane the loader then discards
// — the picker shows a choice, the session reloads, and the lane is silently
// following nobody.

import type { SessionLane } from './session-types';
import { isHarmonic } from '../plugins/capabilities';

export function eligibleLeaders(
  lanes: readonly SessionLane[], followerId: string,
): SessionLane[] {
  return lanes.filter((l) =>
    // Not itself: a lane following itself would ask itself for its own notes.
    l.id !== followerId
    // Harmonic only. A percussion note picks a voice, not a pitch, so there is
    // no harmony in it to read — asked through the capability door so a plugin
    // drum machine answers for itself.
    && isHarmonic(l.engineId)
    // Not already a follower. Allowing a chain means allowing a cycle, and a
    // cycle is an infinite derivation on the scheduler's tick. One level, no
    // exceptions — and it keeps `playedNotesOf` in weave-wiring terminating by
    // construction rather than by luck.
    && !l.follow,
  );
}
