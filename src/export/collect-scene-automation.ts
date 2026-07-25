// src/export/collect-scene-automation.ts
// Pure: sample every sounding clip's enabled envelopes across [0, windowSec) into
// a time-sorted list of automation points. It walks its own sub-step counter, but
// the length it wraps on comes from core/clip-envelope-length — the same call the
// live tick makes — so the export cannot loop the curve on a different period
// than the scheduler does.

import { AUTOMATION_SUB_RES } from '../core/pattern';
import { envelopeValueLength } from '../core/clip-envelope-length';
import type { TimeSignature } from '../core/meter';
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
  meter: TimeSignature,
): OfflineAutomationPoint[] {
  const out: OfflineAutomationPoint[] = [];
  const stepDur = 60 / bpm / 4;
  const subDur = stepDur / AUTOMATION_SUB_RES;
  if (subDur <= 0) return out;
  for (const { laneId, clip } of lanes) {
    if (!clip.envelopes || clip.envelopes.length === 0) continue;
    const totalSubs = envelopeValueLength(clip.lengthBars, meter);
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
