// Pure song-position arithmetic for the global transport (Phase 1). Maps audio
// time ↔ song bars given a single anchor, derives the lane re-anchor for a seek,
// and converts ruler pixels ↔ bars. No DOM, no audio nodes — unit-testable.
import { ticksPerBar, type TimeSignature, DEFAULT_METER } from './meter';
import { TICKS_PER_QUARTER } from './notes';

/** Seconds per song bar at the given tempo + meter, on the TICKS_PER_QUARTER grid. */
export function songBarSec(bpm: number, meter: TimeSignature = DEFAULT_METER): number {
  const secPerTick = (60 / bpm) / TICKS_PER_QUARTER;
  return ticksPerBar(meter) * secPerTick;
}

/** Song position in bars (>= 0) at audio time `now`, given the song anchor. */
export function songPosBars(
  now: number, anchorSec: number, bpm: number, meter: TimeSignature = DEFAULT_METER,
): number {
  const elapsed = Math.max(0, now - anchorSec);
  return elapsed / songBarSec(bpm, meter);
}

/** Anchor that places song position at exactly `targetBar` bars when read at `now`. */
export function seekAnchorSec(
  targetBar: number, now: number, bpm: number, meter: TimeSignature = DEFAULT_METER,
): number {
  return now - Math.max(0, targetBar) * songBarSec(bpm, meter);
}

/** Re-anchor a looping lane so its clip phase matches song-second `targetSongSec`.
 *  The lane repeats every `clipDurSec`; its phase at the target is
 *  `targetSongSec mod clipDurSec`, so the new loop-start anchor = now − phase. */
export function reanchorOnSeek(clipDurSec: number, targetSongSec: number, now: number): number {
  if (clipDurSec <= 0) return now;
  const phase = ((targetSongSec % clipDurSec) + clipDurSec) % clipDurSec;
  return now - phase;
}

/** Ruler x (px) → bar index (>= 0). */
export function barFromRulerX(x: number, pxPerBar: number): number {
  return pxPerBar > 0 ? Math.max(0, x / pxPerBar) : 0;
}

/** Bar index → ruler x (px, >= 0). */
export function rulerXOfBar(bar: number, pxPerBar: number): number {
  return Math.max(0, bar) * pxPerBar;
}
