// src/samples/warp-quality.ts
// Objective quality metric for a warp-marker set: does the inferred beat grid
// actually land on the music's kick hits? This is the "no double-thump" test the
// user judges by ear, made measurable: map each detected kick (a source-time) onto
// the marker grid and check it falls on (near) an integer beat. A well-warped clip
// concentrates kicks at beat phase ~0; a drifting/short marker set smears them.
import type { WarpMarker } from '../session/session';

/** Map a source time to fractional beat position using the markers as
 *  piecewise-linear control points — the exact mapping warpStretch interpolates. */
export function srcToBeat(markers: WarpMarker[], t: number): number {
  if (!markers.length) return 0;
  if (t <= markers[0].srcSec) return markers[0].beat;
  for (let i = 0; i < markers.length - 1; i++) {
    const a = markers[i], b = markers[i + 1];
    if (t >= a.srcSec && t <= b.srcSec) {
      const f = (t - a.srcSec) / Math.max(1e-9, b.srcSec - a.srcSec);
      return a.beat + f * (b.beat - a.beat);
    }
  }
  return markers[markers.length - 1].beat;
}

export interface WarpQuality {
  /** lastMarker.srcSec / durationSec — 1 means the grid reaches the end of the audio. */
  coverage: number;
  /** Fraction of kicks landing within `tol` of an integer beat (1 = every kick on-grid). */
  alignedFrac: number;
  /** Median |phase to nearest beat| over kicks, in fraction of a beat (0 best, 0.25 ≈ random). */
  medianDrift: number;
  /** Number of kicks considered (inside the marker span). */
  n: number;
}

/** Score a marker grid against ground-truth kick times (source seconds). */
export function warpQuality(
  markers: WarpMarker[], kicks: number[], durationSec: number, tol = 0.12,
): WarpQuality {
  const coverage = markers.length ? markers[markers.length - 1].srcSec / Math.max(1e-9, durationSec) : 0;
  const lo = markers.length ? markers[0].srcSec : 0;
  const hi = markers.length ? markers[markers.length - 1].srcSec : 0;
  const phases: number[] = [];
  for (const k of kicks) {
    if (k < lo || k > hi) continue;
    const bp = srcToBeat(markers, k);
    phases.push(Math.abs(bp - Math.round(bp)));
  }
  const alignedFrac = phases.length ? phases.filter((p) => p < tol).length / phases.length : 0;
  phases.sort((a, b) => a - b);
  const medianDrift = phases.length ? phases[Math.floor(phases.length / 2)] : 0.5;
  return { coverage, alignedFrac, medianDrift, n: phases.length };
}

/** A constant-tempo ("naïve") two-marker grid spanning the same beats, for a
 *  baseline: the seed must do at least as well as assuming no drift at all. */
export function naiveGrid(anchorSec: number, bpm: number, lastBeat: number): WarpMarker[] {
  const secPerBeat = 60 / bpm;
  return [
    { srcSec: anchorSec, beat: 0 },
    { srcSec: anchorSec + lastBeat * secPerBeat, beat: lastBeat },
  ];
}
