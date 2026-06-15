// src/samples/warp-region.ts
// Slice a clip's warp markers down to a loop sub-region [startBeat, endBeat),
// rebased so the sub-region starts at beat 0. Used when an AUDIO clip loops only
// part of itself: warpStretch maps target(beat)=beat/lastBeat*gateSec, so to warp
// just the sub-region we hand it markers whose beats run 0..(endBeat-startBeat)
// and whose srcSec span only the matching slice of the source buffer.
//
// `beat` units match the warp grid (quarter notes for integer meters), the same
// space the scheduler derives from clip ticks (tick / TICKS_PER_QUARTER).
import type { WarpMarker } from '../session/session';

/** Piecewise-linear source time for a given beat, by interpolating between the
 *  two surrounding markers (clamped to the endpoints outside the marked span). */
export function srcSecAtBeat(markers: WarpMarker[], beat: number): number {
  if (markers.length === 0) return 0;
  if (beat <= markers[0].beat) return markers[0].srcSec;
  for (let i = 1; i < markers.length; i++) {
    if (beat <= markers[i].beat) {
      const a = markers[i - 1], b = markers[i];
      const span = b.beat - a.beat;
      const t = span > 0 ? (beat - a.beat) / span : 0;
      return a.srcSec + t * (b.srcSec - a.srcSec);
    }
  }
  return markers[markers.length - 1].srcSec;
}

/** Return markers covering [startBeat, endBeat], rebased so startBeat → beat 0.
 *  Endpoints are always present (interpolated if no marker sits exactly there);
 *  interior markers are kept and shifted. Returns the original markers unchanged
 *  when the region is degenerate or empty. */
export function sliceMarkersToRegion(
  markers: WarpMarker[], startBeat: number, endBeat: number,
): WarpMarker[] {
  if (markers.length < 2 || !(endBeat > startBeat)) return markers;
  const out: WarpMarker[] = [{ srcSec: srcSecAtBeat(markers, startBeat), beat: 0 }];
  for (const m of markers) {
    if (m.beat > startBeat && m.beat < endBeat) out.push({ srcSec: m.srcSec, beat: m.beat - startBeat });
  }
  out.push({ srcSec: srcSecAtBeat(markers, endBeat), beat: endBeat - startBeat });
  return out;
}
