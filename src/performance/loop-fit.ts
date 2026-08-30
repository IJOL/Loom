// src/performance/loop-fit.ts
// The drop arithmetic: a dropped audio file is ASSUMED to be a loop, so its
// duration rounds to the nearest whole-bar count at the session tempo and the
// stretch factor makes it fit exactly. Pure arithmetic on purpose — NO
// transient analysis (that avenue was tried and deliberately abandoned); a bad
// fit is corrected by hand through the band's bars-chip.
import { songBarSec } from '../core/song-position';
import type { TimeSignature } from '../core/meter';

export interface LoopFit {
  /** Whole bars the loop is taken to be (>= 1). */
  bars: number;
  /** durationSec / (bars · barSec): the rate the clip's warp applies so the
   *  audio lands exactly on the grid. 1 = already in tempo. */
  stretch: number;
}

export function fitLoopToBars(
  durationSec: number, bpm: number, meter: TimeSignature,
): LoopFit {
  const barSec = songBarSec(bpm, meter);
  const bars = Math.max(1, Math.round(durationSec / barSec));
  return { bars, stretch: durationSec / (bars * barSec) };
}
