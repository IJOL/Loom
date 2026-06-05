// src/export/collect-scene-triggers.ts
// Pure: expand every sounding clip's notes across the render window [0, windowSec)
// into a time-sorted flat list of triggers. Reuses tickLane (one call per clip
// with lookahead = the whole window) and noteTrigger for slide/accent/gate, so
// the offline render matches the live scheduler exactly.

import type { SessionClip, ClipSample } from '../session/session';
import { tickLane, noteTrigger } from '../core/lane-scheduler';
import type { TimeSignature } from '../core/meter';

export interface SoundingLaneClip {
  laneId: string;
  engineId: string;
  clip: SessionClip;
}

export interface OfflineTrigger {
  laneId: string;
  midi: number;
  time: number;       // absolute offline seconds
  gateSec: number;
  accent: boolean;
  slidingIn: boolean;
  sample?: ClipSample;
  slice?: { sampleId: string; start: number; end: number };
}

export function collectSceneTriggers(
  lanes: SoundingLaneClip[],
  bpm: number,
  meter: TimeSignature,
  windowSec: number,
): OfflineTrigger[] {
  const out: OfflineTrigger[] = [];
  for (const { laneId, engineId, clip } of lanes) {
    tickLane(clip, {
      bpm,
      lookaheadSec: windowSec,
      now: 0,
      loopStartedAt: 0,
      lastScheduledAt: -Infinity,
      meter,
      onTrigger: (note, scheduleTime) => {
        if (scheduleTime >= windowSec) return;
        const t = noteTrigger(engineId, clip, note, scheduleTime, 0, bpm, meter);
        out.push({
          laneId,
          midi: t.midi,
          time: scheduleTime,
          gateSec: t.gateSec,
          accent: t.accent,
          slidingIn: t.slidingIn,
          sample: note.sample,
          slice: note.slice,
        });
      },
      onAutomation: () => { /* envelopes are out of scope for offline v1 */ },
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
