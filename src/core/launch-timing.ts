import type { SessionClip } from '../session/session';
import { effectiveClipLoop } from './clip-loop';
import { TICKS_PER_QUARTER } from './notes';
import { tickRangeSec } from './tempo-map';
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

/**
 * Seconds spanned by a tick region of a clip — the single owner of "ticks to
 * seconds" for clip iterations. When the clip carries real tempo changes
 * (an imported MIDI), the region is INTEGRATED over `clip.tempoMap` instead of
 * multiplied by the constant session bpm.
 *
 * The CALLER resolves the region, and that is deliberate: it lets the scheduler
 * pass the scene's GLOBAL loop region without globalLoop ever entering this
 * helper. A global-loop-aware owner would desync `clipLoopSourceRange`, which
 * session-host's audio re-trigger divides against it (see
 * lane-scheduler-anchor.test.ts).
 *
 * The map is integrated over CLIP-LOCAL ticks: the MIDI importer rebases every
 * tempo point onto the clip's own grid, so tick 0 of the map is tick 0 of the
 * clip. A song-absolute map stored on a clip would mis-integrate here.
 */
export function clipRegionSec(
  clip: SessionClip, startTick: number, endTick: number, bpm: number,
): number {
  const tmap = clip.tempoMap && clip.tempoMap.length > 1 ? clip.tempoMap : null;
  if (tmap) return tickRangeSec(tmap, startTick, endTick);
  if (bpm <= 0) return 0;
  return ((endTick - startTick) / TICKS_PER_QUARTER) * (60 / bpm);
}

/** One iteration of the clip's OWN (local) loop, in seconds — tempo-map aware,
 *  so it equals the scheduler's iteration and T lands on a real loop boundary
 *  rather than a bar grid. Global-loop blind on purpose: see clipRegionSec. */
export function clipLoopSec(
  clip: SessionClip, bpm: number, meter: TimeSignature = DEFAULT_METER,
): number {
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  return Math.max(0, clipRegionSec(clip, startTick, endTick, bpm));
}

/** Next loop boundary >= now for a loop that started at loopStartedAt.
 *  k is forced >= 1 so a freshly-started loop returns its FIRST end, never now. */
export function nextLoopEnd(loopStartedAt: number, loopSec: number, now: number): number {
  if (loopSec <= 0) return now;
  const elapsed = now - loopStartedAt;
  const k = elapsed <= 0 ? 1 : Math.ceil(elapsed / loopSec);
  return loopStartedAt + k * loopSec;
}

/** The synchronized switch instant from the currently-playing loops. */
export function sceneSwitchBoundary(
  playing: { loopStartedAt: number; loopSec: number }[],
  now: number,
): number {
  const valid = playing.filter((p) => p.loopSec > 0);
  if (valid.length === 0) return now;
  const gov = governingLoopSec(valid.map((p) => p.loopSec));
  const EPS = 1e-6;
  let best = Infinity;
  for (const p of valid) {
    if (Math.abs(p.loopSec - gov) > EPS) continue;
    const t = nextLoopEnd(p.loopStartedAt, p.loopSec, now);
    if (t < best) best = t;
  }
  return best === Infinity ? now : best;
}
