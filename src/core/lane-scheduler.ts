// Pure per-lane look-ahead scheduler. The transport's tick loop iterates
// over every playing lane and calls tickLane(clip, ctx) for each — this
// function decides which notes (and which automation samples) to schedule
// in the (now, now + lookaheadSec) window, calling back through ctx.
// It also advances the loop boundary when a full clip iteration completes.

import type { SessionClip, ClipEnvelope, ClipSample } from '../session/session';
import { TICKS_PER_QUARTER, TICKS_PER_STEP, type NoteEvent } from './notes';
import { ticksPerBar, DEFAULT_METER, type TimeSignature } from './meter';
import { effectiveClipLoop, laneLoopRegion, type GlobalLoopOverride } from './clip-loop';
import { sliceMarkersToRegion } from '../samples/warp-region';
import { tickRangeSec } from './tempo-map';
import { swungTick, swungSpan } from './swing';

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
  /** Absolute audio time of the LAST note this scheduler already emitted
   *  in a previous tick. tickLane only fires notes with `scheduleAt >
   *  lastScheduledAt`, preventing duplicate fires when consecutive ticks
   *  have overlapping look-ahead windows (the realistic 25ms/120ms case).
   *  Default `-Infinity` means "no notes scheduled yet" (cold start). */
  lastScheduledAt?: number;
  /** Global time signature; absent ⇒ 4/4. Controls loop (bar) duration only —
   *  individual note tick positions are absolute time, meter-independent. */
  meter?: TimeSignature;
  /** Active scene's global loop override. When present and enabled, every clip
   *  uses [startBar, endBar) as its effective region instead of its local loop.
   *  Absent ⇒ behaviour is identical to before (effectiveClipLoop). */
  globalLoop?: GlobalLoopOverride;
  /** Shuffle amount (0 = straight). See core/swing.ts for the mapping. */
  swing?: number;
  /** Called with the original note + the absolute audio time at which it
   *  should be scheduled. */
  onTrigger: (note: { midi: number; duration: number; velocity: number; sample?: ClipSample; gridTick?: number }, scheduleTime: number) => void;
  /** Called for each clip envelope sample falling in the window. The
   *  `clipTimeNorm` is 0..1 within the clip iteration. */
  onAutomation: (env: ClipEnvelope, clipTimeNorm: number, scheduleTime: number) => void;
}

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
 * current loop-start anchor.  When `clip.loopEnabled` is set, both the
 * iteration period and (for audio clips) the triggered buffer trim range
 * are bounded by the clip's effective sub-region via `effectiveClipLoop`.
 *
 * Loop advancement: the function derives how many full clip iterations have
 * completed since ctx.loopStartedAt (using floor division — drift-free
 * because it always measures from the original anchor, never accumulates).
 * The updated loopStartedAt is returned; the caller writes it back.
 */
export function tickLane(clip: SessionClip, ctx: SchedulerContext): number {
  const meter = ctx.meter ?? DEFAULT_METER;
  const swing = ctx.swing ?? 0;
  const secPerBeat = 60 / ctx.bpm;
  // Per-clip tempo map: when the clip varies tempo (imported MIDI with tempo
  // changes), time notes by integrating the map instead of the constant global
  // BPM. Absent / single-tempo ⇒ the normal linear path, unchanged.
  const tmap = clip.tempoMap && clip.tempoMap.length > 1 ? clip.tempoMap : null;
  // Use laneLoopRegion so a global-loop override replaces the clip's local loop.
  // When ctx.globalLoop is absent/disabled, laneLoopRegion === effectiveClipLoop.
  const { startTick, endTick } = laneLoopRegion(clip, meter, ctx.globalLoop);
  const loopTicks = endTick - startTick;
  const clipDurSec = tmap
    ? tickRangeSec(tmap, startTick, endTick)
    : (loopTicks / TICKS_PER_QUARTER) * secPerBeat;
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
  //
  // Per-tick dedupe: in real usage tick=25ms / lookahead=120ms → consecutive
  // ticks have overlapping windows (~95ms overlap). Without the
  // `lastScheduledAt` lower bound below, a note inside the overlap region
  // fires once per tick — i.e. the same note triggers 4-5× per loop
  // iteration, which sounds like glitchy/choppy audio. Bumping
  // `windowStart` past the last scheduled note's absolute time guarantees
  // each note fires exactly once.
  const lastScheduled = ctx.lastScheduledAt ?? -Infinity;
  const windowStart = Math.max(ctx.now - DRIFT, lastScheduled + DRIFT);
  const windowEnd   = ctx.now + ctx.lookaheadSec - DRIFT;

  // Compute the iteration range analytically.  An iteration k starts at
  // loopStart + k*clipDurSec.  We use floor/ceil to get the exact inclusive
  // range of k values that could contain notes in the window.
  const kMin = Math.max(0, Math.floor((windowStart - loopStart) / clipDurSec));
  const kMax = Math.ceil( (windowEnd   - loopStart) / clipDurSec) - 1;

  for (let k = kMin; k <= kMax; k++) {
    const iterStart = loopStart + k * clipDurSec;
    if (clip.sample) {
      // Loop/song or stretch audio clip: one buffer trigger per iteration, gated
      // to the sub-region length. When loopEnabled, trimStart/trimEnd are
      // remapped to the matching fraction of the original buffer so only the
      // corresponding audio plays. duration is the sub-region in ticks
      // (= loopTicks) so it round-trips back to clipDurSec through the
      // runtime's secPerTick (which divides by TICKS_PER_QUARTER).
      if (iterStart >= windowStart && iterStart < windowEnd) {
        const total = clip.lengthBars * ticksPerBar(meter);
        const isWhole = startTick === 0 && endTick === total;
        let sample = clip.sample;
        if (!isWhole) {
          const s = clip.sample;
          if (s.warp && s.warpMarkers && s.warpMarkers.length >= 2) {
            // Warped clip: playback plays the grid-aligned warped buffer from the
            // start (trim is ignored), so a sub-region loop can't be expressed by
            // trimming. Instead slice the markers to the sub-region's beat range
            // (rebased to 0) — warpStretch then renders only that slice into the
            // shorter gate. beat == tick / TICKS_PER_QUARTER on the warp grid.
            sample = {
              ...s,
              warpMarkers: sliceMarkersToRegion(s.warpMarkers, startTick / TICKS_PER_QUARTER, endTick / TICKS_PER_QUARTER),
            };
          } else {
            const span = s.trimEnd - s.trimStart;
            sample = {
              ...s,
              trimStart: s.trimStart + (startTick / total) * span,
              trimEnd:   s.trimStart + (endTick / total) * span,
            };
          }
        }
        ctx.onTrigger({ midi: 60, duration: loopTicks, velocity: 100, sample }, iterStart);
      }
    } else {
      // Note clip: each note fires at its grid time.
      for (const n of clip.notes) {
        if (n.start < startTick || n.start >= endTick) continue;
        const noteStart = swungTick(n.start, swing);
        const clipTimeSec = tmap
          ? tickRangeSec(tmap, startTick, noteStart)
          : ((noteStart - startTick) / TICKS_PER_QUARTER) * secPerBeat;
        const scheduleAt  = iterStart + clipTimeSec;
        if (scheduleAt >= windowStart && scheduleAt < windowEnd) {
          ctx.onTrigger({
            midi: n.midi,
            duration: swungSpan(n.start, n.duration, swing),
            velocity: n.velocity,
            // A warped timeline no longer divides back into the grid tick, so
            // hand noteTrigger the real one. Swung path ONLY: on a tempo-mapped
            // clip the derived value disagrees with the true tick, and swing 0
            // must stay byte-for-byte what it is today.
            gridTick: swing > 0 ? k * loopTicks + (n.start - startTick) : undefined,
          }, scheduleAt);
        }
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

export interface NoteTrigger {
  midi: number;
  gateSec: number;
  accent: boolean;
  slidingIn: boolean;
  velocity: number;
  scheduledStartTick: number;
}

/** Seconds per tick at the given bpm on the TICKS_PER_QUARTER (96) grid that
 *  note start/duration live on. A quarter note = 96 ticks = 60/bpm seconds. */
function secPerTickLocal(bpm: number): number {
  return (60 / bpm) / TICKS_PER_QUARTER;
}

/**
 * Pure note → trigger-shape computation, shared by the live tick (tickSession)
 * and the offline batch collector. `scheduleTime` is the absolute audio time;
 * `loopStart` is the absolute time the current clip iteration began.
 */
export function noteTrigger(
  engineId: string,
  clip: SessionClip,
  note: { midi: number; duration: number; velocity: number; gridTick?: number },
  scheduleTime: number,
  loopStart: number,
  bpm: number,
  meter: TimeSignature | undefined,
): NoteTrigger {
  const m = meter ?? DEFAULT_METER;
  const tickSec = secPerTickLocal(bpm);
  const accent = note.velocity >= 100;
  const gateSec = Math.max(0.01, note.duration * tickSec);
  const scheduledStartTick = (note.gridTick ?? Math.round((scheduleTime - loopStart) / tickSec))
    % (clip.lengthBars * ticksPerBar(m));
  const slidingIn = engineId === 'tb303'
    && (clip.notes as NoteEvent[]).some(
      (other) => other.start < scheduledStartTick
        && (other.start + other.duration) > scheduledStartTick + 1,
    );
  return { midi: note.midi, gateSec, accent, slidingIn, velocity: note.velocity, scheduledStartTick };
}
