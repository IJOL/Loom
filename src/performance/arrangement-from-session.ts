// Pure: flatten a Session (scenes in order) into a playable ArrangementState.
// Each scene becomes a section whose length = the longest effective clip in it
// (a clip's effective length honours its loop sub-region). Every lane with a
// clip in the scene gets one clipEvent spanning the section; the clip loops
// inside that span via session-runtime. Mirrors launchScene's clip resolution
// (explicit clipPerLane wins, else the scene row index).
import type { SessionState } from '../session/session';
import type { TimeSignature } from '../core/meter';
import { ticksPerBar } from '../core/meter';
import { effectiveClipLoop } from '../core/clip-loop';
import { emptyArrangementState, type ArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent } from './arrangement-ops';

export function arrangementFromSession(
  state: SessionState, bpm: number, meter: TimeSignature,
): ArrangementState {
  const arr = emptyArrangementState(bpm);
  const barSec = (60 / bpm) * 4;
  const tpb = ticksPerBar(meter);
  let cursorSec = 0;

  state.scenes.forEach((scene, sceneIdx) => {
    // Resolve each lane's clip for this scene (explicit mapping wins).
    const picks: { laneId: string; clipId: string; bars: number }[] = [];
    for (const lane of state.lanes) {
      const hasExplicit = Object.prototype.hasOwnProperty.call(scene.clipPerLane, lane.id);
      const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;
      if (idx == null) continue;
      const clip = lane.clips[idx];
      if (!clip) continue;
      const { startTick, endTick } = effectiveClipLoop(clip, meter);
      picks.push({ laneId: lane.id, clipId: clip.id, bars: (endTick - startTick) / tpb });
    }
    if (picks.length === 0) return;
    const sectionSec = Math.max(...picks.map((p) => p.bars)) * barSec;
    for (const p of picks) {
      appendClipEvent(arr, p.laneId, p.clipId, cursorSec);
      closePendingClipEvent(arr, p.laneId, cursorSec + sectionSec);
    }
    cursorSec += sectionSec;
  });

  arr.durationSec = cursorSec;
  return arr;
}
