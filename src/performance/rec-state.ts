import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { ArrangementState } from './performance';
import { stepsPerSec } from './performance';
import { writeAutomationSample } from './arrangement-ops';

export interface RecState {
  armed: boolean;
  recording: boolean;
  startedAtCtx: number;
  /** ParamIds whose knob was moved since the last `tickRecAutomation`. */
  touched: Set<string>;
}

export function createRecState(): RecState {
  return { armed: false, recording: false, startedAtCtx: 0, touched: new Set() };
}

export function armRec(rec: RecState): void { rec.armed = true; }
export function disarmRec(rec: RecState): void { rec.armed = false; rec.recording = false; }

export function startRecording(rec: RecState, nowCtx: number): void {
  if (!rec.armed) return;
  rec.recording = true;
  rec.startedAtCtx = nowCtx;
  rec.touched.clear();
}

export function stopRecording(rec: RecState): void {
  rec.recording = false;
  rec.touched.clear();
}

export function arrangementNow(rec: RecState, nowCtx: number): number {
  return Math.max(0, nowCtx - rec.startedAtCtx);
}

export function markParamTouched(rec: RecState, paramId: string): void {
  if (!rec.recording) return;
  rec.touched.add(paramId);
}

export interface TickRecAutomationArgs {
  rec: RecState;
  state: ArrangementState;
  nowCtx: number;
  bpm: number;
  laneIds: readonly string[];
  /** Reads the current normalized (0..1) value of the named knob. */
  readValue: (paramId: string) => number;
}

export function tickRecAutomation(args: TickRecAutomationArgs): void {
  const { rec, state, nowCtx, bpm, laneIds, readValue } = args;
  if (!rec.recording || rec.touched.size === 0) return;
  const tNow = arrangementNow(rec, nowCtx);
  const subIdx = Math.floor(tNow * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
  for (const paramId of rec.touched) {
    writeAutomationSample(state, paramId, readValue(paramId), subIdx, laneIds);
  }
  rec.touched.clear();
}
