// src/export/scene-duration.ts
// Pure scene-duration math. The export plays the longest sounding clip once;
// shorter clips loop to fill that window (the looping itself is the runtime's
// job — here we only compute how many seconds to capture).

import type { LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { type TimeSignature } from '../core/meter';
import { TICKS_PER_QUARTER } from '../core/notes';
import { effectiveClipLoop } from '../core/clip-loop';

/** Musical length of one clip iteration, in seconds. Mirrors lane-scheduler's
 *  `tickLane`: when a loop sub-region is active the iteration is the LOOP length,
 *  not the whole clip. Without this, an audio clip looping a few bars of a long
 *  buffer reports its full `lengthBars` (hundreds of bars), so the offline render
 *  window balloons to the whole buffer and hangs the browser. For a clip with no
 *  loop `effectiveClipLoop` returns [0, lengthBars·ticksPerBar) ⇒ identical to the
 *  old `lengthBars · quartersPerBar · 60/bpm`. */
export function clipDurationSec(clip: SessionClip, meter: TimeSignature, bpm: number): number {
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  return ((endTick - startTick) / TICKS_PER_QUARTER) * (60 / bpm);
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
