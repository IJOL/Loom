// src/export/scene-duration.ts
// Pure scene-duration math. The export plays the longest sounding clip once;
// shorter clips loop to fill that window (the looping itself is the runtime's
// job — here we only compute how many seconds to capture).

import type { LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

/** Musical length of one clip iteration, in seconds. Mirrors lane-scheduler. */
export function clipDurationSec(clip: SessionClip, meter: TimeSignature, bpm: number): number {
  return clip.lengthBars * quartersPerBar(meter) * (60 / bpm);
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
