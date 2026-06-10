import type { ArrangementState } from './performance';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { stepsPerSec } from './performance';
import { sampleAutomationAt } from './arrangement-ops';

export interface ArrangementPlayState {
  isPlaying: boolean;
  startedAtCtx: number;
  laneOverridden: Map<string, boolean>;
  nextEventIdxPerLane: Map<string, number>;
  /** Stops are tracked separately from launches so a clip whose untilSec lands
   *  beyond the launch tick's lookahead still gets stopped when the playhead
   *  reaches it (otherwise the lane looped forever). */
  nextStopIdxPerLane: Map<string, number>;
  ended: boolean;
}

export function createArrangementPlayState(): ArrangementPlayState {
  return {
    isPlaying: false,
    startedAtCtx: 0,
    laneOverridden: new Map(),
    nextEventIdxPerLane: new Map(),
    nextStopIdxPerLane: new Map(),
    ended: false,
  };
}

export function startArrangement(ps: ArrangementPlayState, nowCtx: number): void {
  ps.isPlaying = true;
  ps.startedAtCtx = nowCtx;
  ps.nextEventIdxPerLane.clear();
  ps.nextStopIdxPerLane.clear();
  ps.ended = false;
}

export function stopArrangement(ps: ArrangementPlayState): void {
  ps.isPlaying = false;
  ps.nextEventIdxPerLane.clear();
  ps.nextStopIdxPerLane.clear();
}

/** Point every lane's launch/stop pointers at `atSec` (skipping events already
 *  finished by then) and relaunch the clip spanning `atSec` at `relaunchAtCtx`.
 *  Shared by the A-B loop wrap and the loop-start seek (startArrangementAt). */
function anchorLanesAt(
  ps: ArrangementPlayState,
  state: ArrangementState,
  atSec: number,
  relaunchAtCtx: number,
  onLaunchClip: (laneId: string, clipId: string, atCtx: number) => void,
): void {
  for (const lane of state.lanes) {
    let idx = 0;
    let stopIdx = 0;
    let active: typeof lane.clipEvents[number] | undefined;
    for (let i = 0; i < lane.clipEvents.length; i++) {
      const ev = lane.clipEvents[i];
      // A clip spanning atSec (starts before, ends after) keeps sounding → relaunch.
      if (ev.atSec < atSec && atSec < ev.untilSec) active = ev;
      if (ev.atSec < atSec) idx = i + 1;
      if (Number.isFinite(ev.untilSec) && ev.untilSec <= atSec) stopIdx = i + 1;
    }
    ps.nextEventIdxPerLane.set(lane.laneId, idx);
    ps.nextStopIdxPerLane.set(lane.laneId, stopIdx);
    if (active) onLaunchClip(lane.laneId, active.clipId, relaunchAtCtx);
  }
}

/** Start playback with the playhead seeked to `startSec` (e.g. the A of an
 *  active A-B loop) rather than 0, relaunching the clip active across that point
 *  so it sounds immediately. `startSec <= 0` is a plain start. */
export function startArrangementAt(
  ps: ArrangementPlayState,
  nowCtx: number,
  state: ArrangementState,
  startSec: number,
  onLaunchClip: (laneId: string, clipId: string, atCtx: number) => void,
): void {
  startArrangement(ps, nowCtx);
  if (startSec <= 0) return;
  // Anchor the clock so the first tick's tNow lands at startSec; relaunch the
  // active clip now (startedAtCtx + startSec === nowCtx).
  ps.startedAtCtx = nowCtx - startSec;
  anchorLanesAt(ps, state, startSec, nowCtx, onLaunchClip);
}

export function overrideLane(ps: ArrangementPlayState, laneId: string): void {
  ps.laneOverridden.set(laneId, true);
}

export function backToArrangement(ps: ArrangementPlayState): void {
  ps.laneOverridden.clear();
}

export function isLaneOverridden(ps: ArrangementPlayState, laneId: string): boolean {
  return ps.laneOverridden.get(laneId) === true;
}

export function arrangementPlayhead(ps: ArrangementPlayState, nowCtx: number): number {
  if (!ps.isPlaying) return 0;
  return Math.max(0, nowCtx - ps.startedAtCtx);
}

export interface TickArrangementArgs {
  ps: ArrangementPlayState;
  state: ArrangementState;
  nowCtx: number;
  lookaheadSec: number;
  bpm: number;
  onLaunchClip: (laneId: string, clipId: string, atCtx: number) => void;
  onStopLane: (laneId: string, atCtx: number) => void;
  applyAutomation: (paramId: string, valueNorm: number) => void;
  loopWindow?: { startSec: number; endSec: number; active: boolean };
  onArrangementEnd?: () => void;
}

export function tickArrangement(args: TickArrangementArgs): void {
  const { ps, state, nowCtx, lookaheadSec, bpm, onLaunchClip, onStopLane, applyAutomation } = args;
  if (!ps.isPlaying) return;
  const tNow = arrangementPlayhead(ps, nowCtx);
  const tMax = tNow + lookaheadSec;

  const CONTIGUOUS_EPS = 1e-6;
  for (const lane of state.lanes) {
    if (isLaneOverridden(ps, lane.laneId)) continue;
    // Launches: fire each event whose atSec has entered the lookahead window.
    let i = ps.nextEventIdxPerLane.get(lane.laneId) ?? 0;
    while (i < lane.clipEvents.length && lane.clipEvents[i].atSec < tMax) {
      const ev = lane.clipEvents[i];
      onLaunchClip(lane.laneId, ev.clipId, ps.startedAtCtx + ev.atSec);
      i++;
    }
    ps.nextEventIdxPerLane.set(lane.laneId, i);
    // Stops: a SEPARATE pointer so a stop whose untilSec lands beyond the launch
    // tick's lookahead still fires once the playhead reaches it. Skip the boundary
    // between contiguous events (the next clip's launch supersedes, so an explicit
    // stop would re-trigger a gap). Open events (untilSec=Infinity, mid-recording)
    // and events still ahead of the window halt the scan.
    let j = ps.nextStopIdxPerLane.get(lane.laneId) ?? 0;
    while (j < lane.clipEvents.length) {
      const ev = lane.clipEvents[j];
      if (!Number.isFinite(ev.untilSec) || ev.untilSec >= tMax) break;
      const next = lane.clipEvents[j + 1];
      const contiguous = next != null && next.atSec <= ev.untilSec + CONTIGUOUS_EPS;
      if (!contiguous) onStopLane(lane.laneId, ps.startedAtCtx + ev.untilSec);
      j++;
    }
    ps.nextStopIdxPerLane.set(lane.laneId, j);
  }

  const subIdx = Math.floor(tNow * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
  for (const lane of state.lanes) {
    if (isLaneOverridden(ps, lane.laneId)) continue;
    for (const curve of lane.automation) {
      if (curve.enabled === false) continue;
      applyAutomation(curve.paramId, sampleAutomationAt(curve, subIdx));
    }
  }
  for (const curve of state.globalAutomation) {
    if (curve.enabled === false) continue;
    applyAutomation(curve.paramId, sampleAutomationAt(curve, subIdx));
  }

  const lw = args.loopWindow;
  if (lw && tNow + lookaheadSec >= lw.endSec) {
    if (!lw.active) {
      if (!ps.ended) {
        for (const lane of state.lanes) onStopLane(lane.laneId, ps.startedAtCtx + lw.endSec);
        ps.ended = true;
        args.onArrangementEnd?.();
      }
    } else {
      const period = lw.endSec - lw.startSec;
      // 1) stop everyone at B
      for (const lane of state.lanes) onStopLane(lane.laneId, ps.startedAtCtx + lw.endSec);
      // 2) re-anchor so the next tick's tNow lands back at A
      ps.startedAtCtx += period;
      // 3) reset launch/stop pointers to A and relaunch the clip spanning A so it
      //    keeps sounding after the wrap (shared with the loop-start seek). An
      //    event starting exactly at A is relaunched by the next tick's while-loop,
      //    not here, so it does not double-fire.
      anchorLanesAt(ps, state, lw.startSec, ps.startedAtCtx + lw.startSec, onLaunchClip);
    }
  }
}
