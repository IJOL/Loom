// src/samples/warp-seed.ts
// Auto-seed Ableton-style warp markers: a regular beat grid (from the detected
// tempo + downbeat) with each beat latched to the nearest onset within tolerance,
// so the markers track where the beats actually are and absorb tempo drift.
import type { WarpMarker } from '../session/session';

/** @param onsets detected onset times (s). @param downbeatSec beat-0 position.
 *  @param bpm detected tempo. @param durationSec source length. */
export function seedWarpMarkers(
  onsets: number[], downbeatSec: number, bpm: number, durationSec: number,
): WarpMarker[] {
  const beatSec = 60 / bpm;
  if (!(beatSec > 0) || !(durationSec > 0)) return [];
  const tol = beatSec * 0.5;
  const sorted = [...onsets].sort((a, b) => a - b);
  const markers: WarpMarker[] = [];
  let prevSrc = -Infinity;
  for (let beat = 0; ; beat++) {
    const expected = downbeatSec + beat * beatSec;
    if (expected > durationSec) break;
    // nearest onset within tolerance, else the regular-grid time
    let src = expected, bestD = tol;
    for (const o of sorted) {
      const d = Math.abs(o - expected);
      if (d < bestD) { bestD = d; src = o; }
    }
    // keep srcSec strictly increasing (a snap could collide / reorder)
    if (src <= prevSrc) src = Math.min(expected, prevSrc + beatSec * 0.01);
    if (src <= prevSrc) continue;
    markers.push({ srcSec: src, beat });
    prevSrc = src;
  }
  return markers;
}
