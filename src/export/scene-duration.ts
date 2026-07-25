// src/export/scene-duration.ts
// Pure scene-duration math. The export plays the longest sounding clip once;
// shorter clips loop to fill that window (the looping itself is the runtime's
// job — here we only compute how many seconds to capture).

import type { LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { type TimeSignature } from '../core/meter';
import { clipLoopSec } from '../core/launch-timing';

/** Musical length of one clip iteration, in seconds. The owner is
 *  `clipLoopSec` (core/launch-timing) — the same number the scheduler loops on,
 *  including a tempo-mapped clip's real length and an active loop sub-region.
 *  Note the argument order is the mirror of the owner's. */
export function clipDurationSec(clip: SessionClip, meter: TimeSignature, bpm: number): number {
  return clipLoopSec(clip, bpm, meter);
}

/** Longest sounding clip across all lanes, in seconds. 0 ⇒ nothing playing. */
export function soundingSceneDurationSec(
  laneStates: Map<string, LanePlayState>,
  meter: TimeSignature,
  bpm: number,
): number {
  let max = 0;
  for (const lp of laneStates.values()) {
    if (!lp.playing) continue;
    const d = clipDurationSec(lp.playing, meter, bpm);
    if (d > max) max = d;
  }
  return max;
}
