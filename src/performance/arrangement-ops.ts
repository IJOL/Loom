import { emptyLaneRec, type ArrangementLaneRec, type ArrangementState } from './performance';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { AutomationCurve } from './performance';

export function getOrCreateLane(s: ArrangementState, laneId: string): ArrangementLaneRec {
  let rec = s.lanes.find((l) => l.laneId === laneId);
  if (!rec) {
    rec = emptyLaneRec(laneId);
    s.lanes.push(rec);
  }
  return rec;
}

export function appendClipEvent(
  s: ArrangementState, laneId: string, clipId: string, atSec: number,
): void {
  const rec = getOrCreateLane(s, laneId);
  const last = rec.clipEvents[rec.clipEvents.length - 1];
  if (last && last.untilSec === Infinity) last.untilSec = atSec;
  rec.clipEvents.push({ clipId, laneId, atSec, untilSec: Infinity });
}

export function closePendingClipEvent(
  s: ArrangementState, laneId: string, atSec: number,
): void {
  const rec = s.lanes.find((l) => l.laneId === laneId);
  if (!rec) return;
  const last = rec.clipEvents[rec.clipEvents.length - 1];
  if (!last || last.untilSec !== Infinity) return;
  last.untilSec = atSec;
}

export type ParamRoute =
  | { kind: 'lane'; laneId: string }
  | { kind: 'global' };

export function routeParamId(paramId: string, laneIds: readonly string[]): ParamRoute {
  let best: string | null = null;
  for (const id of laneIds) {
    if (paramId.startsWith(id + '.') && (best === null || id.length > best.length)) {
      best = id;
    }
  }
  return best ? { kind: 'lane', laneId: best } : { kind: 'global' };
}

function getOrCreateCurve(
  list: AutomationCurve[], paramId: string,
): AutomationCurve {
  let c = list.find((x) => x.paramId === paramId);
  if (!c) {
    c = { paramId, samples: [] };
    list.push(c);
  }
  return c;
}

function holdExtend(samples: number[], idx: number): void {
  if (idx < samples.length) return;
  const last = samples.length > 0 ? samples[samples.length - 1] : 0.5;
  while (samples.length <= idx) samples.push(last);
}

export function writeAutomationSample(
  s: ArrangementState,
  paramId: string,
  valueNorm: number,
  subIdx: number,
  laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? getOrCreateLane(s, route.laneId).automation
    : s.globalAutomation;
  const curve = getOrCreateCurve(list, paramId);
  holdExtend(curve.samples, subIdx);
  curve.samples[subIdx] = valueNorm;
}

export function sampleAutomationAt(curve: AutomationCurve, subIdx: number): number {
  if (curve.samples.length === 0) return 0.5;
  const i = Math.min(subIdx, curve.samples.length - 1);
  return curve.samples[i];
}
