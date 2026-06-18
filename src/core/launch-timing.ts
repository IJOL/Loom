import type { SessionClip } from '../session/session';
import { effectiveClipLoop } from './clip-loop';
import { TICKS_PER_QUARTER } from './notes';
import { DEFAULT_METER, type TimeSignature } from './meter';

// Pure helpers for "when does a scene/clip switch happen" — the switch instant
// T is the end of the loop that GOVERNS the currently-playing material.

/**
 * The governing loop length given the lengths of every currently-playing loop.
 * Rule (user-approved): sort the lengths WITH DUPLICATES (multiset) descending,
 * then while the single largest element is more than 2× the next element, drop
 * that one largest element and re-compare. The largest survivor governs.
 * `lengths` may be in seconds or bars (the ratio test is scale-free).
 */
export function governingLoopSec(lengths: number[]): number {
  const sorted = lengths.filter((l) => l > 0).sort((a, b) => b - a);
  if (sorted.length === 0) return 0;
  let i = 0;
  while (i < sorted.length - 1 && sorted[i] > 2 * sorted[i + 1]) i++;
  return sorted[i];
}

/** Loop length in seconds — wraps effectiveClipLoop so it equals the scheduler's
 *  clipDurSec exactly (T must land on a real loop boundary, not a bar grid). */
export function clipLoopSec(
  clip: SessionClip, bpm: number, meter: TimeSignature = DEFAULT_METER,
): number {
  if (bpm <= 0) return 0;
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  const loopTicks = endTick - startTick;
  if (loopTicks <= 0) return 0;
  return (loopTicks / TICKS_PER_QUARTER) * (60 / bpm);
}

/** Next loop boundary >= now for a loop that started at loopStartedAt.
 *  k is forced >= 1 so a freshly-started loop returns its FIRST end, never now. */
export function nextLoopEnd(loopStartedAt: number, loopSec: number, now: number): number {
  if (loopSec <= 0) return now;
  const elapsed = now - loopStartedAt;
  const k = elapsed <= 0 ? 1 : Math.ceil(elapsed / loopSec);
  return loopStartedAt + k * loopSec;
}
