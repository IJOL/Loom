// src/export/scene-restart.ts
// Re-anchors every currently-sounding lane so its clip restarts from the top
// at `startTime`. Reuses the runtime's queued→playing promotion (which, on
// crossing queuedBoundary, resets loopStartedAt/lastScheduledAt/nextStepIdx),
// giving the export a clean pass beginning at beat 1.

import type { LanePlayState } from '../session/session-runtime';

/** Sets queued = playing and queuedBoundary = startTime for each sounding lane.
 *  Returns the ids of lanes that were sounding (empty ⇒ nothing to export). */
export function restartSoundingLanesForExport(
  laneStates: Map<string, LanePlayState>,
  startTime: number,
): string[] {
  const sounding: string[] = [];
  for (const lp of laneStates.values()) {
    if (!lp.playing) continue;
    lp.queued = lp.playing;
    lp.queuedBoundary = startTime;
    sounding.push(lp.laneId);
  }
  return sounding;
}
