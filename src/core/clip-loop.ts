// Pure resolver for a clip's loop sub-region. Single source of truth for the
// scheduler, the sampler buffer trim and the editor brace. Returns absolute
// tick bounds on the clip's own TICKS_PER_QUARTER grid; loop off / invalid /
// out-of-range all collapse to the whole clip [0, total).
import type { SessionClip } from '../session/session';
import { ticksPerBar, stepsPerBar, type TimeSignature } from './meter';
import { TICKS_PER_STEP, TICKS_PER_QUARTER } from './notes';
import { srcSecAtBeat } from '../samples/warp-region';

/** Optional global-loop descriptor threaded from the active scene into the
 *  scheduler. When `enabled` is true the scheduler uses [startBar, endBar) as
 *  the per-clip effective region instead of the clip's own local loop. */
export interface GlobalLoopOverride {
  enabled: boolean;
  startBar: number;
  endBar: number;
}

export function effectiveClipLoop(
  clip: SessionClip, meter: TimeSignature,
): { startTick: number; endTick: number } {
  const total = clip.lengthBars * ticksPerBar(meter);
  if (!clip.loopEnabled) return { startTick: 0, endTick: total };
  const start = Math.max(0, Math.min(clip.loopStartTick ?? 0, total));
  const end = Math.max(0, Math.min(clip.loopEndTick ?? total, total));
  if (end <= start) return { startTick: 0, endTick: total };
  return { startTick: start, endTick: end };
}

/** Effective loop region for a lane's clip, with optional global-loop override.
 *
 * When `globalLoop.enabled` is true and the mapped region [A*ticksPerBar,
 * B*ticksPerBar) is non-degenerate and within the clip's tick range, it is
 * returned as the effective region — ignoring any per-clip local loop. This
 * makes every lane in the scene start at A and loop [A,B).
 *
 * When globalLoop is absent, disabled, or maps to a degenerate/out-of-range
 * region, the result is identical to `effectiveClipLoop(clip, meter)` — so the
 * no-global-loop path is byte-for-byte unchanged (additive safety property). */
export function laneLoopRegion(
  clip: SessionClip,
  meter: TimeSignature,
  globalLoop?: GlobalLoopOverride,
): { startTick: number; endTick: number } {
  if (globalLoop?.enabled) {
    const total = clip.lengthBars * ticksPerBar(meter);
    const tpb = ticksPerBar(meter);
    const rawStart = globalLoop.startBar * tpb;
    const rawEnd = globalLoop.endBar * tpb;
    const startTick = Math.max(0, Math.min(rawStart, total));
    const endTick = Math.max(0, Math.min(rawEnd, total));
    // Only use global region if it is non-degenerate within the clip
    if (endTick > startTick) {
      return { startTick, endTick };
    }
    // Degenerate (A>=B after clamping, or both beyond clip end) → fall through
  }
  return effectiveClipLoop(clip, meter);
}

/** Current playhead position (in 16th steps on the FULL-clip axis) for a playing
 *  clip, given how many steps have elapsed since launch. The cursor sweeps the
 *  clip's EFFECTIVE loop region [startStep, endStep) and wraps there — so it tracks
 *  the audio (which loops that same region) instead of running the whole clip.
 *  Pass `globalLoop` so the playhead follows the scene-wide region exactly like the
 *  scheduler does: with Global on there is NO difference between local and global —
 *  audio, playhead and brace all sweep [A,B). Consumers map the result to x
 *  (÷ totalSteps) or to ticks (× TICKS_PER_STEP). */
export function loopAwareStep(
  clip: SessionClip, meter: TimeSignature, stepsElapsed: number,
  globalLoop?: GlobalLoopOverride,
): number {
  const elapsed = Math.max(0, stepsElapsed);
  const { startTick, endTick } = laneLoopRegion(clip, meter, globalLoop);
  const startStep = startTick / TICKS_PER_STEP;
  const loopSteps = Math.max(1, (endTick - startTick) / TICKS_PER_STEP);
  return startStep + (elapsed % loopSteps);
}

/** SOURCE-audio [startSec, endSec) of a clip's effective loop region (the whole
 *  clip when loop is off). For a WARPED clip the loop lives in beat space, so map
 *  beats → source seconds through the warp markers (srcSecAtBeat); for a plain clip
 *  the loop tick-fraction maps onto the [trimStart, trimEnd) span of the buffer.
 *  Used to slice the audio for transcribing JUST the loop. */
export function clipLoopSourceRange(
  clip: SessionClip, meter: TimeSignature, bufferDuration: number,
): { startSec: number; endSec: number } {
  const total = Math.max(1, clip.lengthBars * ticksPerBar(meter));
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  const s = clip.sample;
  if (s?.warp && s.warpMarkers && s.warpMarkers.length >= 2) {
    return {
      startSec: srcSecAtBeat(s.warpMarkers, startTick / TICKS_PER_QUARTER),
      endSec: srcSecAtBeat(s.warpMarkers, endTick / TICKS_PER_QUARTER),
    };
  }
  const trimStart = Math.max(0, s?.trimStart ?? 0);
  const trimEnd = (s && s.trimEnd > trimStart) ? Math.min(s.trimEnd, bufferDuration) : bufferDuration;
  const span = Math.max(0.001, trimEnd - trimStart);
  return { startSec: trimStart + (startTick / total) * span, endSec: trimStart + (endTick / total) * span };
}
