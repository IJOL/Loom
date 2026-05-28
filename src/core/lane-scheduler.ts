// Pure per-lane look-ahead scheduler. The transport's tick loop iterates
// over every playing lane and calls tickLane(clip, ctx) for each — this
// function decides which notes (and which automation samples) to schedule
// in the (now, now + lookaheadSec) window, calling back through ctx.
// It also advances the loop boundary when a full clip iteration completes.

import type { SessionClip, ClipEnvelope } from '../session/session';
import { TICKS_PER_STEP } from './notes';

export interface SchedulerContext {
  bpm: number;
  /** Look-ahead horizon in seconds (e.g., 0.12). */
  lookaheadSec: number;
  /** Current audio time (ctx.currentTime). */
  now: number;
  /** Absolute audio time when this lane's current loop iteration started.
   *  The function advances this past completed iterations and returns the
   *  updated value. */
  loopStartedAt: number;
  /** Called with the original note + the absolute audio time at which it
   *  should be scheduled. */
  onTrigger: (note: { midi: number; duration: number; velocity: number }, scheduleTime: number) => void;
  /** Called for each clip envelope sample falling in the window. The
   *  `clipTimeNorm` is 0..1 within the clip iteration. */
  onAutomation: (env: ClipEnvelope, clipTimeNorm: number, scheduleTime: number) => void;
}

/** TICKS_PER_BAR for the SessionClip note coordinate space (16 steps/bar). */
const TICKS_PER_BAR = TICKS_PER_STEP * 16;

/**
 * Per-note schedule-time drift tolerance (1 µs).  Applied symmetrically:
 *
 *   windowStart = now - DRIFT   — catches notes whose exact time is slightly
 *                                  below `now` due to floating-point drift in
 *                                  the accumulated tick counter.
 *   windowEnd   = now + lookahead - DRIFT  — excludes notes that fall exactly
 *                                  on the next loop boundary when lookahead
 *                                  exactly equals the tick interval (the
 *                                  degenerate test-driving case).
 *
 * 1 µs is far below the minimum inter-note gap (~7 ms at 300 bpm), so no
 * legitimate note can be double-fired or missed.
 */
const DRIFT = 1e-6;

/**
 * Tick a single lane's clip scheduler within the look-ahead window.
 *
 * The algorithm is modelled on Chris Wilson's "A Tale of Two Clocks": for
 * every note in the clip whose absolute schedule time falls in the window,
 * call ctx.onTrigger.  Notes are iterated by converting their clip-tick
 * position to seconds, then projecting onto the absolute timeline using the
 * current loop-start anchor.
 *
 * Loop advancement: the function derives how many full clip iterations have
 * completed since ctx.loopStartedAt (using floor division — drift-free
 * because it always measures from the original anchor, never accumulates).
 * The updated loopStartedAt is returned; the caller writes it back.
 */
export function tickLane(clip: SessionClip, ctx: SchedulerContext): number {
  const secPerBeat = 60 / ctx.bpm;
  const clipDurSec = clip.lengthBars * 4 * secPerBeat;
  if (clipDurSec <= 0) return ctx.loopStartedAt;

  // Derive how many full iterations have completed since the original anchor.
  // Using floor(elapsed / clipDurSec) keeps the loopStart error-free: it
  // never accumulates across iterations, so float drift stays at the level
  // of a single division rather than growing with loop count.
  const elapsed = ctx.now - ctx.loopStartedAt;
  const completedIterations = elapsed < 0 ? 0 : Math.floor(elapsed / clipDurSec);
  const loopStart = ctx.loopStartedAt + completedIterations * clipDurSec;

  // Symmetric DRIFT window: expand the lower bound to catch notes whose exact
  // time has been overtaken by a drifting `now`; shrink the upper bound to
  // prevent premature scheduling at the next loop boundary.
  const windowStart = ctx.now - DRIFT;
  const windowEnd   = ctx.now + ctx.lookaheadSec - DRIFT;

  // Compute the iteration range analytically.  An iteration k starts at
  // loopStart + k*clipDurSec.  We use floor/ceil to get the exact inclusive
  // range of k values that could contain notes in the window.
  const kMin = Math.max(0, Math.floor((windowStart - loopStart) / clipDurSec));
  const kMax = Math.ceil( (windowEnd   - loopStart) / clipDurSec) - 1;

  for (let k = kMin; k <= kMax; k++) {
    const iterStart = loopStart + k * clipDurSec;
    for (const n of clip.notes) {
      const clipTimeSec = (n.start / TICKS_PER_BAR) * 4 * secPerBeat;
      const scheduleAt  = iterStart + clipTimeSec;
      if (scheduleAt >= windowStart && scheduleAt < windowEnd) {
        ctx.onTrigger(
          { midi: n.midi, duration: n.duration, velocity: n.velocity },
          scheduleAt,
        );
      }
    }
    for (const env of (clip.envelopes ?? [])) {
      // Sample the envelope at this iteration's start; finer interpolation
      // can be added in a later task.  The clip-time normalised value (0..1)
      // lets the caller map the envelope to whatever target value it wants.
      ctx.onAutomation(env, 0, iterStart);
    }
  }

  return loopStart;
}
