// Pure resolver for a clip's loop sub-region. Single source of truth for the
// scheduler, the sampler buffer trim and the editor brace. Returns absolute
// tick bounds on the clip's own TICKS_PER_QUARTER grid; loop off / invalid /
// out-of-range all collapse to the whole clip [0, total).
import type { SessionClip } from '../session/session';
import { ticksPerBar, stepsPerBar, type TimeSignature } from './meter';
import { TICKS_PER_STEP, TICKS_PER_QUARTER } from './notes';
import { srcSecAtBeat } from '../samples/warp-region';

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

/** Current playhead position (in 16th steps on the FULL-clip axis) for a playing
 *  clip, given how many steps have elapsed since launch. When a loop sub-region is
 *  active the cursor sweeps [startStep, endStep) and wraps there — so it tracks the
 *  audio (which loops that same sub-region) instead of running the whole clip.
 *  Consumers map the result to x (÷ totalSteps) or to ticks (× TICKS_PER_STEP). */
export function loopAwareStep(clip: SessionClip, meter: TimeSignature, stepsElapsed: number): number {
  const totalSteps = Math.max(1, clip.lengthBars * stepsPerBar(meter));
  const elapsed = Math.max(0, stepsElapsed);
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  if (clip.loopEnabled && endTick > startTick) {
    const startStep = startTick / TICKS_PER_STEP;
    const loopSteps = (endTick - startTick) / TICKS_PER_STEP;
    return loopSteps > 0 ? startStep + (elapsed % loopSteps) : startStep;
  }
  return elapsed % totalSteps;
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
