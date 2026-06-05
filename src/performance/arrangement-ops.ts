import { emptyLaneRec, stepsPerSec, type ArrangementLaneRec, type ArrangementState } from './performance';
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
    c = { paramId, values: [], enabled: true, stepped: false };
    list.push(c);
  }
  return c;
}

function holdExtend(values: number[], idx: number): void {
  if (idx < values.length) return;
  const last = values.length > 0 ? values[values.length - 1] : 0.5;
  while (values.length <= idx) values.push(last);
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
  holdExtend(curve.values, subIdx);
  curve.values[subIdx] = valueNorm;
}

export function sampleAutomationAt(curve: AutomationCurve, subIdx: number): number {
  if (curve.values.length === 0) return 0.5;
  const i = Math.min(subIdx, curve.values.length - 1);
  return curve.values[i];
}

/** Seconds covered by an automation curve at the arrangement's bpm. */
function automationEndSec(curve: AutomationCurve, bpm: number): number {
  return curve.values.length / (stepsPerSec(bpm) * AUTOMATION_SUB_RES);
}

/**
 * Close out a recording: clamp any still-open clip event to `atSec` (the stop
 * time) and set `durationSec` to the end of the last recorded content (clips +
 * automation). Stays 0 when nothing was recorded, so the UI keeps its
 * empty-state. Pure — operates on `s` in place.
 */
export function finalizeArrangement(s: ArrangementState, atSec: number): void {
  for (const lane of s.lanes) {
    const last = lane.clipEvents[lane.clipEvents.length - 1];
    if (last && last.untilSec === Infinity) last.untilSec = atSec;
  }
  let dur = 0;
  for (const lane of s.lanes) {
    for (const ev of lane.clipEvents) {
      if (Number.isFinite(ev.untilSec)) dur = Math.max(dur, ev.untilSec);
    }
    for (const c of lane.automation) dur = Math.max(dur, automationEndSec(c, s.bpm));
  }
  for (const c of s.globalAutomation) dur = Math.max(dur, automationEndSec(c, s.bpm));
  s.durationSec = dur;
}

/** Bars * seconds-per-bar at the arrangement bpm. */
function barSec(bpm: number): number { return (60 / bpm) * 4; }

/** Render/sizing length: the larger of the recorded duration and the
 *  user-set bar length. 0 only when nothing is recorded AND no length set. */
export function effectiveDurationSec(s: ArrangementState): number {
  return Math.max(s.durationSec, s.lengthBars * barSec(s.bpm));
}

/** Resolve the playback window in seconds. Loop off / invalid ⇒ inactive with
 *  endSec at the full effective duration (the song-end stop boundary). */
export function arrangementLoopWindowSec(
  s: ArrangementState,
): { startSec: number; endSec: number; active: boolean } {
  const fullEnd = effectiveDurationSec(s);
  if (!s.loopEnabled) return { startSec: 0, endSec: fullEnd, active: false };
  const bs = barSec(s.bpm);
  const start = Math.max(0, (s.loopStartBar ?? 0) * bs);
  const end = Math.min(fullEnd, (s.loopEndBar ?? fullEnd / bs) * bs);
  if (end <= start) return { startSec: 0, endSec: fullEnd, active: false };
  return { startSec: start, endSec: end, active: true };
}

/** Sub-step count for a given number of bars at AUTOMATION_SUB_RES. */
export function subStepsForBars(bars: number): number {
  return Math.max(0, Math.round(bars)) * 16 * AUTOMATION_SUB_RES;
}

function resizeCurve(curve: AutomationCurve, targetLen: number): void {
  if (targetLen <= 0) return;
  if (curve.values.length < targetLen) {
    const last = curve.values.length > 0 ? curve.values[curve.values.length - 1] : 0.5;
    while (curve.values.length < targetLen) curve.values.push(last);
  } else if (curve.values.length > targetLen) {
    curve.values.length = targetLen;
  }
}

/** Set the user length (bars) and resize every curve (lane + global) to the
 *  effective length, holding the last value when growing, truncating on shrink. */
export function setArrangementLengthBars(s: ArrangementState, bars: number): void {
  s.lengthBars = Math.max(0, Math.round(bars));
  const targetBars = Math.ceil(effectiveDurationSec(s) / barSec(s.bpm));
  const targetLen = subStepsForBars(targetBars);
  for (const lane of s.lanes) for (const c of lane.automation) resizeCurve(c, targetLen);
  for (const c of s.globalAutomation) resizeCurve(c, targetLen);
}

/** Create an empty (0.5-filled) automation curve for `paramId`, routed by
 *  prefix into its lane or globalAutomation. No-op if it already exists. */
export function addAutomationCurve(
  s: ArrangementState, paramId: string, laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? getOrCreateLane(s, route.laneId).automation
    : s.globalAutomation;
  if (list.some((c) => c.paramId === paramId)) return;
  const targetBars = Math.max(1, Math.ceil(effectiveDurationSec(s) / barSec(s.bpm)));
  const len = subStepsForBars(targetBars);
  list.push({ paramId, values: Array.from({ length: len }, () => 0.5), enabled: true, stepped: false });
}

/** Remove the curve for `paramId` from its routed list. */
export function removeAutomationCurve(
  s: ArrangementState, paramId: string, laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? s.lanes.find((l) => l.laneId === route.laneId)?.automation
    : s.globalAutomation;
  if (!list) return;
  const i = list.findIndex((c) => c.paramId === paramId);
  if (i >= 0) list.splice(i, 1);
}
