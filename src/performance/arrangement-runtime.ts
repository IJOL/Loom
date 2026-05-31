import type { ArrangementState } from './performance';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { stepsPerSec } from './performance';
import { sampleAutomationAt } from './arrangement-ops';

export interface ArrangementPlayState {
  isPlaying: boolean;
  startedAtCtx: number;
  laneOverridden: Map<string, boolean>;
  nextEventIdxPerLane: Map<string, number>;
}

export function createArrangementPlayState(): ArrangementPlayState {
  return {
    isPlaying: false,
    startedAtCtx: 0,
    laneOverridden: new Map(),
    nextEventIdxPerLane: new Map(),
  };
}

export function startArrangement(ps: ArrangementPlayState, nowCtx: number): void {
  ps.isPlaying = true;
  ps.startedAtCtx = nowCtx;
  ps.nextEventIdxPerLane.clear();
}

export function stopArrangement(ps: ArrangementPlayState): void {
  ps.isPlaying = false;
  ps.nextEventIdxPerLane.clear();
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
}

export function tickArrangement(args: TickArrangementArgs): void {
  const { ps, state, nowCtx, lookaheadSec, bpm, onLaunchClip, onStopLane, applyAutomation } = args;
  if (!ps.isPlaying) return;
  const tNow = arrangementPlayhead(ps, nowCtx);
  const tMax = tNow + lookaheadSec;

  for (const lane of state.lanes) {
    if (isLaneOverridden(ps, lane.laneId)) continue;
    let i = ps.nextEventIdxPerLane.get(lane.laneId) ?? 0;
    while (i < lane.clipEvents.length) {
      const ev = lane.clipEvents[i];
      if (ev.atSec >= tMax) break;
      onLaunchClip(lane.laneId, ev.clipId, ps.startedAtCtx + ev.atSec);
      if (Number.isFinite(ev.untilSec) && ev.untilSec < tMax) {
        onStopLane(lane.laneId, ps.startedAtCtx + ev.untilSec);
      }
      i++;
    }
    ps.nextEventIdxPerLane.set(lane.laneId, i);
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
}
