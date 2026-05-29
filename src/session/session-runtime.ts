// Live performance state for Session mode. Holds per-lane play position,
// queue, and the tick-side scheduler that is called from the main 25 ms loop.

import type { SessionClip, SessionState, LaunchQuantize, SessionLane } from './session';
import { tickLane } from '../core/lane-scheduler';
import { TICKS_PER_STEP } from '../core/notes';
import type { NoteEvent } from '../core/notes';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { RecState } from '../performance/rec-state';
import { arrangementNow } from '../performance/rec-state';
import type { ArrangementState } from '../performance/performance';
import { appendClipEvent, closePendingClipEvent } from '../performance/arrangement-ops';

export interface RecHooks {
  rec: RecState;
  arrangement: ArrangementState;
}

export interface LanePlayState {
  laneId: string;
  playing: SessionClip | null;
  queued: SessionClip | null;
  queuedBoundary: number;
  startTime: number;
  nextStepIdx: number;
  loopCount: number;
  /** Absolute audio time when the current loop iteration began.
   *  Used by tickLane to project note-tick positions onto the timeline.
   *  Reset to startTime whenever a new clip is promoted from the queue. */
  loopStartedAt: number;
  /** Absolute audio time of the LAST note this lane has already scheduled.
   *  Passed into tickLane so consecutive overlapping look-ahead windows
   *  (25 ms tick × 120 ms lookahead → ~95 ms overlap) don't re-emit the
   *  same note 4-5×. Reset to -Infinity when a new clip is promoted. */
  lastScheduledAt: number;
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
    loopStartedAt: 0,
    lastScheduledAt: -Infinity,
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
  _hooks?: RecHooks,
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

export function stopLane(
  laneStates: Map<string, LanePlayState>,
  laneId: string,
  hooks?: RecHooks & { nowCtx?: number },
): void {
  const lp = laneStates.get(laneId);
  if (!lp) return;
  lp.playing = null;
  lp.queued = null;
  if (hooks?.rec.recording) {
    const at = arrangementNow(hooks.rec, hooks.nowCtx ?? hooks.rec.startedAtCtx);
    closePendingClipEvent(hooks.arrangement, laneId, at);
  }
}

export function stopAll(laneStates: Map<string, LanePlayState>): void {
  for (const lp of laneStates.values()) {
    lp.playing = null;
    lp.queued = null;
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────

/** Called for every note that falls in the look-ahead window. */
export type LaneTriggerFn = (
  laneId: string,
  midi: number,
  scheduleTime: number,
  gateDuration: number,
  accent: boolean,
  slidingIn: boolean,
) => void;

/** Called each time a step boundary fires (for visual playhead updates). */
export type ClipStepFiredFn = (
  laneId: string,
  clipId: string,
  stepInClip: number,
  stepTime: number,
) => void;

/** Seconds per tick at the given bpm. 16 steps/bar × 24 ticks/step. */
function secPerTick(bpm: number): number {
  return (60 / bpm) / TICKS_PER_STEP;
}

export function tickSession(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  now: number,
  lookahead: number,
  bpm: number,
  onLaneTrigger: LaneTriggerFn,
  onClipStepFired: ClipStepFiredFn,
  hooks?: RecHooks,
): void {
  for (const lane of state.lanes) {
    const lp = laneStates.get(lane.id);
    if (!lp) continue;

    // Promote queued → playing once we cross the boundary
    if (lp.queued && now + lookahead >= lp.queuedBoundary) {
      lp.playing = lp.queued;
      lp.queued = null;
      lp.startTime = lp.queuedBoundary;
      lp.loopStartedAt = lp.queuedBoundary;
      lp.nextStepIdx = 0;
      lp.loopCount = 0;
      lp.lastScheduledAt = -Infinity;
      if (hooks?.rec.recording) {
        const at = arrangementNow(hooks.rec, lp.queuedBoundary);
        appendClipEvent(hooks.arrangement, lane.id, lp.playing!.id, at);
      }
    }

    if (!lp.playing) continue;
    const clip = lp.playing;
    const tickSec = secPerTick(bpm);
    // Capture the loop start before tickLane potentially advances it.
    // onTrigger fires synchronously inside tickLane, so this value is valid
    // for all triggers produced in this tick.
    const currentLoopStart = lp.loopStartedAt;

    const newLoopStart = tickLane(clip, {
      bpm,
      lookaheadSec: lookahead,
      now,
      loopStartedAt: currentLoopStart,
      lastScheduledAt: lp.lastScheduledAt,
      onTrigger: (note: { midi: number; duration: number; velocity: number }, scheduleTime: number) => {
        if (scheduleTime > lp.lastScheduledAt) lp.lastScheduledAt = scheduleTime;
        const accent = note.velocity >= 100;
        const gateSec = Math.max(0.01, note.duration * tickSec);
        // Derive tick position within the clip from the schedule time and the
        // current loop start.  tickLane always calls onTrigger with an absolute
        // scheduleTime that is loopStart + (noteTick / TICKS_PER_BAR) * barSec.
        // Back-computing gives us the same tick value the note was stored at
        // (within 1 µs float tolerance, well inside TICKS_PER_STEP/2 gap).
        const scheduledStartTick = Math.round((scheduleTime - currentLoopStart) / tickSec)
          % (clip.lengthBars * 16 * TICKS_PER_STEP);
        // TB-303 slide: a prior note whose end overlaps this note's start.
        const slidingIn = lane.engineId === 'tb303'
          && (clip.notes as NoteEvent[]).some(
            (m) => m.start < scheduledStartTick
              && (m.start + m.duration) > scheduledStartTick + 1,
          );
        onLaneTrigger(lane.id, note.midi, scheduleTime, gateSec, accent, slidingIn);
        onClipStepFired(
          lane.id, clip.id,
          Math.floor(scheduledStartTick / TICKS_PER_STEP),
          scheduleTime,
        );
      },
      onAutomation: () => {
        // Automation kept minimal in Phase D.3; refined in a later task.
      },
    });
    lp.loopStartedAt = newLoopStart;
  }
}

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
