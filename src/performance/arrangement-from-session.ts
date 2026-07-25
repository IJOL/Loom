// Pure: flatten a Session (scenes in order) into a playable ArrangementState.
// Each scene becomes a section whose length = the longest effective clip in it
// (a clip's effective length honours its loop sub-region). Every lane with a
// clip in the scene gets one clipEvent spanning the section; the clip loops
// inside that span via session-runtime. Mirrors launchScene's clip resolution
// (explicit clipPerLane wins, else the scene row index).
//
// Section length comes from clipLoopSec — the same helper the scene-switch
// boundary and the offline renderer use — rather than a bar count times a bar
// length. A bar product is only right while every bar is the same length, which
// is exactly what an imported MIDI's tempo map breaks.
//
// Known debt that leaves behind: the seconds are then right, but the Performance
// ruler and the length field still size a bar with songBarSec at the
// arrangement's single bpm, so on multi-tempo material a section boundary no
// longer lands on a drawn bar line. ArrangementState has no tempo map to fix it
// with. Written up in docs/superpowers/REMAINING-WORK.md; pinned in
// arrangement-from-session.test.ts.
import type { SessionState } from '../session/session';
import type { TimeSignature } from '../core/meter';
import { clipLoopSec } from '../core/launch-timing';
import { emptyArrangementState, type ArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent } from './arrangement-ops';

export function arrangementFromSession(
  state: SessionState, bpm: number, meter: TimeSignature,
): ArrangementState {
  // `meter` sizes the source clips (clipLoopSec); the arrangement itself keeps
  // no meter — bars are the song's, so the view reads it from the Sequencer.
  const arr = emptyArrangementState(bpm);
  let cursorSec = 0;

  state.scenes.forEach((scene, sceneIdx) => {
    // Resolve each lane's clip for this scene (explicit mapping wins).
    const picks: { laneId: string; clipId: string; sec: number }[] = [];
    for (const lane of state.lanes) {
      const hasExplicit = Object.prototype.hasOwnProperty.call(scene.clipPerLane, lane.id);
      const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;
      if (idx == null) continue;
      const clip = lane.clips[idx];
      if (!clip) continue;
      picks.push({ laneId: lane.id, clipId: clip.id, sec: clipLoopSec(clip, bpm, meter) });
    }
    if (picks.length === 0) return;
    const sectionSec = Math.max(...picks.map((p) => p.sec));
    for (const p of picks) {
      appendClipEvent(arr, p.laneId, p.clipId, cursorSec);
      closePendingClipEvent(arr, p.laneId, cursorSec + sectionSec);
    }
    cursorSec += sectionSec;
  });

  arr.durationSec = cursorSec;
  return arr;
}
