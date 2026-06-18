// Live performance state for Session mode. Holds per-lane play position,
// queue, and the tick-side scheduler that is called from the main 25 ms loop.

import type { SessionClip, SessionState, LaunchQuantize, SessionLane, ClipSample, SessionScene } from './session';
import { emptyScene, clipRowCount, cloneClipWithNewId } from './session';
import { tickLane, noteTrigger } from '../core/lane-scheduler';
import { TICKS_PER_STEP } from '../core/notes';
import { DEFAULT_METER, type TimeSignature } from '../core/meter';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { clipLoopSec, nextLoopEnd, sceneSwitchBoundary } from '../core/launch-timing';
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

/** Capture the currently-playing clips into a NEW scene row: clone each playing
 *  clip (fresh id) into a fresh bottom row so the new scene visibly CONTAINS the
 *  clips (Ableton "Capture"), then add a launchable scene for that row. Idle lanes
 *  get an empty slot in the new row. Mutates `state`. Returns the new scene, or
 *  `null` (no mutation) when nothing is playing. The new scene keeps clipPerLane
 *  empty: launching it falls back to its own row index, which is where the clones
 *  live, so it plays exactly the captured clips and leaves idle lanes silent. */
export function captureSceneFromPlaying(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
): SessionScene | null {
  const captured: { lane: SessionLane; clip: SessionClip }[] = [];
  for (const lane of state.lanes) {
    const playing = laneStates.get(lane.id)?.playing;
    if (!playing) continue;
    const clip = lane.clips.find((c) => c?.id === playing.id);
    if (clip) captured.push({ lane, clip });
  }
  if (captured.length === 0) return null;
  // The captured row sits below every existing clip/scene row.
  const newRow = clipRowCount(state);
  for (const { lane, clip } of captured) {
    while (lane.clips.length <= newRow) lane.clips.push(null);
    lane.clips[newRow] = cloneClipWithNewId(clip);
  }
  // Guarantee a launchable scene up to (and including) the new row — normally one.
  while (state.scenes.length <= newRow) {
    state.scenes.push(emptyScene(`Scene ${state.scenes.length + 1}`));
  }
  return state.scenes[newRow];
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
  meter: TimeSignature = DEFAULT_METER,
  _hooks?: RecHooks,
): void {
  let lp = laneStates.get(lane.id);
  if (!lp) { lp = emptyLanePlayState(lane.id); laneStates.set(lane.id, lp); }
  lp.queued = clip;
  if (lp.playing) {
    // Hot swap: wait for THIS lane's current clip to finish its loop (no premature
    // entry). No outlier cap — it is a single loop.
    const loopSec = clipLoopSec(lp.playing, bpm, meter);
    lp.queuedBoundary = nextLoopEnd(lp.loopStartedAt, loopSec, now);
  } else {
    // Cold start: nothing to sync to → the quantize grid governs.
    const q = effectiveQuantize(state, lane, clip);
    lp.queuedBoundary = nextBoundary(q, now, bpm);
  }
}

/** Launch a clip to start at an EXACT audio-clock time, bypassing launch
 *  quantize. Arrangement playback already computes the precise start time
 *  (startedAtCtx + atSec); routing it through the bar-quantized {@link launchClip}
 *  re-snaps it to the next absolute bar boundary of the AudioContext grid, which
 *  made the arrangement begin on bar 2 — a silent first bar whose length varied
 *  with the sub-bar phase at Play ("sometimes it starts late"). */
export function launchClipAtTime(
  laneStates: Map<string, LanePlayState>,
  lane: SessionLane,
  clip: SessionClip,
  atCtx: number,
): void {
  let lp = laneStates.get(lane.id);
  if (!lp) { lp = emptyLanePlayState(lane.id); laneStates.set(lane.id, lp); }
  lp.queued = clip;
  lp.queuedBoundary = atCtx;
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

/** Stop hooks shared by every stop seam. `rec`/`arrangement` close any pending
 *  recorded clip event; `silence` immediately releases the lane's LIVE voices
 *  (so a long 'audio' clip stops the instant Stop is pressed, not when the loop
 *  ends). Both are optional so non-audio/non-recording callers stay simple. */
export type StopHooks = Partial<RecHooks> & {
  nowCtx?: number;
  /** Live-voice silencer (the LiveVoiceRegistry). */
  silence?: { silenceLane(laneId: string, now: number): void };
};

export function stopLane(
  laneStates: Map<string, LanePlayState>,
  laneId: string,
  hooks?: StopHooks,
): void {
  const lp = laneStates.get(laneId);
  if (!lp) return;
  lp.playing = null;
  lp.queued = null;
  // Silence live voices first so the audio is cut even if there is no rec hook.
  if (hooks?.silence) hooks.silence.silenceLane(laneId, hooks.nowCtx ?? 0);
  if (hooks?.rec?.recording && hooks.arrangement) {
    const at = arrangementNow(hooks.rec, hooks.nowCtx ?? hooks.rec.startedAtCtx);
    closePendingClipEvent(hooks.arrangement, laneId, at);
  }
}

export function stopAll(
  laneStates: Map<string, LanePlayState>,
  silence?: { silenceAll(now: number): void },
  nowCtx = 0,
): void {
  for (const lp of laneStates.values()) {
    lp.playing = null;
    lp.queued = null;
  }
  if (silence) silence.silenceAll(nowCtx);
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
  sample?: ClipSample,
  velocity?: number,
) => void;

/** Called each time a step boundary fires (for visual playhead updates). */
export type ClipStepFiredFn = (
  laneId: string,
  clipId: string,
  stepInClip: number,
  stepTime: number,
) => void;

export function tickSession(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  now: number,
  lookahead: number,
  bpm: number,
  onLaneTrigger: LaneTriggerFn,
  onClipStepFired: ClipStepFiredFn,
  hooks?: RecHooks,
  meter: TimeSignature = DEFAULT_METER,
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
    // Capture the loop start before tickLane potentially advances it.
    // onTrigger fires synchronously inside tickLane, so this value is valid
    // for all triggers produced in this tick.
    const currentLoopStart = lp.loopStartedAt;

    const newLoopStart = tickLane(clip, {
      bpm,
      lookaheadSec: lookahead,
      now,
      loopStartedAt: currentLoopStart,
      meter,
      lastScheduledAt: lp.lastScheduledAt,
      onTrigger: (note: { midi: number; duration: number; velocity: number; sample?: ClipSample }, scheduleTime: number) => {
        if (scheduleTime > lp.lastScheduledAt) lp.lastScheduledAt = scheduleTime;
        const t = noteTrigger(lane.engineId, clip, note, scheduleTime, currentLoopStart, bpm, meter);
        onLaneTrigger(lane.id, t.midi, scheduleTime, t.gateSec, t.accent, t.slidingIn, note.sample, t.velocity);
        onClipStepFired(
          lane.id, clip.id,
          Math.floor(t.scheduledStartTick / TICKS_PER_STEP),
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
