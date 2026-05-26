// Live performance state for Session mode. Holds per-lane play position,
// queue, and the tick-side scheduler that is called from the main 25 ms loop.

import type { SessionClip, SessionState, LaunchQuantize, SessionLane } from './session';

export interface LanePlayState {
  laneId: string;
  playing: SessionClip | null;
  queued: SessionClip | null;
  queuedBoundary: number;
  startTime: number;
  nextStepIdx: number;
  loopCount: number;
}

export function emptyLanePlayState(laneId: string): LanePlayState {
  return {
    laneId,
    playing: null,
    queued: null,
    queuedBoundary: 0,
    startTime: 0,
    nextStepIdx: 0,
    loopCount: 0,
  };
}

// ── Quantize ───────────────────────────────────────────────────────────────

export function nextBoundary(q: LaunchQuantize, now: number, bpm: number): number {
  if (q === 'immediate') return now;
  const beatDur = 60 / bpm;
  const beats: Record<Exclude<LaunchQuantize, 'immediate'>, number> = {
    '1/4': 1, '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16,
  };
  const quantDur = beats[q] * beatDur;
  return Math.ceil(now / quantDur) * quantDur;
}

export function effectiveQuantize(
  state: SessionState,
  lane: SessionLane,
  clip: SessionClip | null,
): LaunchQuantize {
  return clip?.launchQuantize ?? lane.launchQuantize ?? state.globalQuantize;
}

// ── Launch / stop ──────────────────────────────────────────────────────────

export function launchClip(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  lane: SessionLane,
  clip: SessionClip,
  now: number,
  bpm: number,
): void {
  let lp = laneStates.get(lane.id);
  if (!lp) { lp = emptyLanePlayState(lane.id); laneStates.set(lane.id, lp); }
  const q = effectiveQuantize(state, lane, clip);
  lp.queued = clip;
  lp.queuedBoundary = nextBoundary(q, now, bpm);
}

export function launchScene(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  scene: { clipPerLane: Record<string, number | null> },
  sceneIdx: number,
  now: number,
  bpm: number,
): void {
  // Resolve each lane's target clip: explicit mapping wins, otherwise fall back
  // to the scene's row index (Ableton model: scene N launches column N).
  const resolved: { lane: SessionLane; clip: SessionClip }[] = [];
  for (const lane of state.lanes) {
    const hasExplicit = Object.prototype.hasOwnProperty.call(scene.clipPerLane, lane.id);
    const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;
    if (idx == null) continue;
    const clip = lane.clips[idx];
    if (!clip) continue;
    resolved.push({ lane, clip });
  }
  if (resolved.length === 0) return;

  // All lanes share the same boundary so they start aligned.
  let boundary = -1;
  for (const { lane } of resolved) {
    const q = lane.launchQuantize ?? state.globalQuantize;
    const b = nextBoundary(q, now, bpm);
    if (b > boundary) boundary = b;
  }
  for (const { lane, clip } of resolved) {
    let lp = laneStates.get(lane.id);
    if (!lp) { lp = emptyLanePlayState(lane.id); laneStates.set(lane.id, lp); }
    lp.queued = clip;
    lp.queuedBoundary = boundary;
  }
}

export function stopLane(laneStates: Map<string, LanePlayState>, laneId: string): void {
  const lp = laneStates.get(laneId);
  if (!lp) return;
  lp.playing = null;
  lp.queued = null;
}

export function stopAll(laneStates: Map<string, LanePlayState>): void {
  for (const lp of laneStates.values()) {
    lp.playing = null;
    lp.queued = null;
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────

// Callback that schedules a single 16th step of a clip on a specific lane.
// The host wires this up to the existing trigger functions (synth.trigger,
// polysynth.trigger, drums.trigger, engine voice triggers). It is invoked
// for every step that falls inside the look-ahead window.
export type ScheduleClipStepFn = (
  laneId: string,
  clip: SessionClip,
  stepInClip: number,
  stepStartTime: number,
  stepDur: number,
) => void;

const MAX_CATCH_UP_SEC = 0.5;

export function tickSession(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  now: number,
  lookahead: number,
  bpm: number,
  scheduleStep: ScheduleClipStepFn,
): void {
  const stepDur = 60 / bpm / 4; // 16th-note duration

  for (const lane of state.lanes) {
    const lp = laneStates.get(lane.id);
    if (!lp) continue;

    // Promote queued → playing once we cross the boundary
    if (lp.queued && now + lookahead >= lp.queuedBoundary) {
      lp.playing = lp.queued;
      lp.queued = null;
      lp.startTime = lp.queuedBoundary;
      lp.nextStepIdx = 0;
      lp.loopCount = 0;
    }

    if (!lp.playing) continue;
    const clip = lp.playing;
    const clipSteps = Math.max(1, clip.lengthBars * 16);

    // Background-tab catch-up safety: if we're way behind, jump the
    // playhead to "now" instead of scheduling a backlog of triggers.
    const expectedNextTime = lp.startTime + lp.nextStepIdx * stepDur;
    if (now - expectedNextTime > MAX_CATCH_UP_SEC) {
      const stepsAhead = Math.floor((now - lp.startTime) / stepDur);
      lp.nextStepIdx = stepsAhead;
    }

    // Schedule any 16ths that fall in (now, now + lookahead]
    while (true) {
      const stepTime = lp.startTime + lp.nextStepIdx * stepDur;
      if (stepTime >= now + lookahead) break;
      const stepInClip = lp.nextStepIdx % clipSteps;
      if (lp.nextStepIdx > 0 && stepInClip === 0) lp.loopCount++;
      scheduleStep(lane.id, clip, stepInClip, stepTime, stepDur);
      lp.nextStepIdx++;
    }
  }
}

import { AUTOMATION_SUB_RES } from '../core/pattern';

export type ApplyParamFn = (paramId: string, normalised: number) => void;

export function tickSessionEnvelopes(
  laneStates: Map<string, LanePlayState>,
  now: number,
  bpm: number,
  apply: ApplyParamFn,
): void {
  const stepDur = 60 / bpm / 4;
  for (const lp of laneStates.values()) {
    if (!lp.playing) continue;
    const clip = lp.playing;
    if (!clip.envelopes || clip.envelopes.length === 0) continue;
    const clipSteps = Math.max(1, clip.lengthBars * 16);
    const totalSubs = clipSteps * AUTOMATION_SUB_RES;
    const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
    const subIdx = Math.floor(stepsElapsed * AUTOMATION_SUB_RES) % totalSubs;
    for (const env of clip.envelopes) {
      const v = env.values[subIdx] ?? 0.5;
      apply(env.paramId, v);
    }
  }
}
