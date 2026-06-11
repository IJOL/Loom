// src/export/collect-scene-automation.ts
// Pure: sample every sounding clip's enabled envelopes across [0, windowSec) into
// a time-sorted list of automation points. Mirrors tickSessionEnvelopes' indexing
// (AUTOMATION_SUB_RES sub-steps per 16th step, looping with % totalSubs) so the
// offline render's automation matches the live scheduler.

import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { SoundingLaneClip } from './collect-scene-triggers';

export interface OfflineAutomationPoint {
  laneId: string;
  paramId: string;    // engine-local id (laneId prefix stripped), e.g. 'filter.cutoff'
  normalised: number; // 0..1 (the stored envelope value)
  time: number;       // absolute offline seconds
}

export function collectSceneAutomation(
  lanes: SoundingLaneClip[],
  bpm: number,
  windowSec: number,
): OfflineAutomationPoint[] {
  const out: OfflineAutomationPoint[] = [];
  const stepDur = 60 / bpm / 4;
  const subDur = stepDur / AUTOMATION_SUB_RES;
  if (subDur <= 0) return out;
  for (const { laneId, clip } of lanes) {
    if (!clip.envelopes || clip.envelopes.length === 0) continue;
    const clipSteps = Math.max(1, clip.lengthBars * 16);
    const totalSubs = clipSteps * AUTOMATION_SUB_RES;
    for (const env of clip.envelopes) {
      if (env.enabled === false) continue;
      // paramId is '<laneId>.<localId>'; setBaseValue wants the local id.
      const dot = env.paramId.indexOf('.');
      const localId = dot >= 0 ? env.paramId.slice(dot + 1) : env.paramId;
      for (let i = 0; i * subDur < windowSec; i++) {
        const v = env.values[i % totalSubs] ?? 0.5;
        out.push({ laneId, paramId: localId, normalised: v, time: i * subDur });
      }
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
