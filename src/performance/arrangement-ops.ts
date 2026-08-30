import { emptyLaneRec, newBandId, stepsPerSec, type ArrangementLaneRec, type ArrangementState } from './performance';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { songBarSec } from '../core/song-position';
import { stepsPerBar, type TimeSignature } from '../core/meter';
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
  rec.clipEvents.push({ id: newBandId(), clipId, laneId, atSec, untilSec: Infinity });
}

/** Opens an event at t=0 for each clip that was ALREADY sounding when the take
 *  started.
 *
 *  Clip events are otherwise only recorded on a queued→playing promotion, so a
 *  take armed over a scene that is already running captured nothing: launching
 *  that same scene again is a no-op by design (`launchScene` leaves an
 *  in-phase clip running), and no other promotion ever comes. The take then
 *  finalized empty and Performance kept showing its empty state. What the user
 *  hears at the moment REC starts belongs in the take, so it is seeded here.
 *
 *  A lane whose event was already opened (a promotion landing on the very same
 *  boundary) is left alone — that record is the more precise one. */
export function seedClipEventsFromSounding(
  s: ArrangementState,
  sounding: readonly { laneId: string; clipId: string }[],
): void {
  for (const { laneId, clipId } of sounding) {
    const rec = getOrCreateLane(s, laneId);
    const last = rec.clipEvents[rec.clipEvents.length - 1];
    if (last && last.untilSec === Infinity) continue;
    rec.clipEvents.push({ id: newBandId(), clipId, laneId, atSec: 0, untilSec: Infinity });
  }
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
  recomputeDurationSec(s);
}

/**
 * Set `durationSec` to the end of the last piece of content (clips + automation).
 * Must run after ANY edit that moves content in time — this was only ever reached
 * through finalizeArrangement (i.e. only after a REC take), so a band dragged
 * longer left the arrangement believing its old length: the band rendered clipped
 * against it, the ruler refused to grow and playback stopped at the stale end.
 * Pure — operates on `s` in place. Ignores still-open (Infinity) events, which
 * belong to a take that is still recording.
 */
export function recomputeDurationSec(s: ArrangementState): void {
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

/** Seconds of one bar of the SONG this arrangement sits in. The meter is the
 *  caller's to supply (the Sequencer owns it) — it is never stored here, so it
 *  cannot go stale behind a meter change. */
function barSecOf(s: ArrangementState, meter: TimeSignature): number {
  return songBarSec(s.bpm, meter);
}

/** Render/sizing length: the larger of the recorded duration and the
 *  user-set bar length. 0 only when nothing is recorded AND no length set. */
export function effectiveDurationSec(s: ArrangementState, meter: TimeSignature): number {
  return Math.max(s.durationSec, s.lengthBars * barSecOf(s, meter));
}

/** Resolve the playback window in seconds. Loop off / invalid ⇒ inactive with
 *  endSec at the full effective duration (the song-end stop boundary). */
export function arrangementLoopWindowSec(
  s: ArrangementState, meter: TimeSignature,
): { startSec: number; endSec: number; active: boolean } {
  const fullEnd = effectiveDurationSec(s, meter);
  if (!s.loopEnabled) return { startSec: 0, endSec: fullEnd, active: false };
  const bs = barSecOf(s, meter);
  const start = Math.max(0, (s.loopStartBar ?? 0) * bs);
  const end = Math.min(fullEnd, (s.loopEndBar ?? fullEnd / bs) * bs);
  if (end <= start) return { startSec: 0, endSec: fullEnd, active: false };
  return { startSec: start, endSec: end, active: true };
}

/** Sub-step count for a given number of bars at AUTOMATION_SUB_RES.
 *
 *  This measures the SAME bar barSecOf does, and it has to: an arrangement curve
 *  is indexed by absolute time (arrangement-runtime samples it at
 *  `tNow * stepsPerSec(bpm) * SUB_RES`), so a curve sized for N bars only ends
 *  where N bars end if both agree on how long one is. While they disagreed the
 *  curve overran the timeline, recomputeDurationSec read that overrun back as
 *  content, and every band edit stretched the song a little further.
 *
 *  Still deliberately NOT routed through core/clip-envelope-length: that owns the
 *  same question for CLIP envelopes, which are indexed by clip-local step and
 *  wrap on the clip's own loop. Two different questions that happen to share an
 *  answer in 4/4. */
export function subStepsForBars(bars: number, meter: TimeSignature): number {
  return Math.max(0, Math.round(bars)) * stepsPerBar(meter) * AUTOMATION_SUB_RES;
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
export function setArrangementLengthBars(
  s: ArrangementState, bars: number, meter: TimeSignature,
): void {
  s.lengthBars = Math.max(0, Math.round(bars));
  const targetBars = Math.ceil(effectiveDurationSec(s, meter) / barSecOf(s, meter));
  const targetLen = subStepsForBars(targetBars, meter);
  for (const lane of s.lanes) for (const c of lane.automation) resizeCurve(c, targetLen);
  for (const c of s.globalAutomation) resizeCurve(c, targetLen);
}

/** Create an empty (0.5-filled) automation curve for `paramId`, routed by
 *  prefix into its lane or globalAutomation. No-op if it already exists. */
export function addAutomationCurve(
  s: ArrangementState, paramId: string, laneIds: readonly string[], meter: TimeSignature,
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? getOrCreateLane(s, route.laneId).automation
    : s.globalAutomation;
  if (list.some((c) => c.paramId === paramId)) return;
  const targetBars = Math.max(1, Math.ceil(effectiveDurationSec(s, meter) / barSecOf(s, meter)));
  const len = subStepsForBars(targetBars, meter);
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
