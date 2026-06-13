// src/samples/warp-seed-sparse.ts
// Sparse, drift-following warp-marker seed. Stage 1 tracks every beat from the
// detected tempo, snapping to nearby onsets and letting the period drift so
// markers latch to where beats actually are. Stage 2 thins to one marker every
// `barsPerMarker` bars and PINS the endpoints (beat 0 and clipBars*beatsPerBar)
// so warpStretch's proportional mapping lands each marker on the grid.
import type { WarpMarker } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

export function seedSparseWarpMarkers(
  onsets: number[],
  downbeatSec: number,
  bpm: number,
  durationSec: number,
  meter: TimeSignature,
  barsPerMarker: number,
  clipBars: number,
): WarpMarker[] {
  const period0 = 60 / bpm;
  const bpb = Math.max(1, Math.round(quartersPerBar(meter)));
  if (!(period0 > 0) || !(durationSec > 0) || clipBars < 1) return [];
  const sorted = onsets.filter((o) => o >= 0).sort((a, b) => a - b);

  // Stage 1 — track every beat time, following drift.
  const beatTimes: number[] = [];
  let period = period0;
  let actual = Math.max(0, downbeatSec);
  beatTimes.push(actual);
  const lastBeat = clipBars * bpb;
  for (let beat = 1; beat <= lastBeat + bpb; beat++) {
    const predicted = actual + period;
    const tol = period * 0.5;
    let snapped = predicted, best = tol;
    for (const o of sorted) {
      const d = Math.abs(o - predicted);
      if (d < best) { best = d; snapped = o; }
    }
    const observed = snapped - actual;
    if (observed > period0 * 0.4 && observed < period0 * 1.6) {
      period = period * 0.5 + observed * 0.5; // blend toward observed spacing
    }
    actual = snapped > actual ? snapped : predicted;
    beatTimes.push(Math.min(actual, durationSec));
    if (actual >= durationSec) break;
  }
  if (beatTimes.length <= bpb) return []; // not even one bar tracked

  // Stage 2 — thin to one marker / barsPerMarker bars, pin endpoints.
  const stride = Math.max(1, Math.round(barsPerMarker)) * bpb;
  const markers: WarpMarker[] = [];
  let prevSrc = -Infinity;
  const push = (beat: number) => {
    const b = Math.min(beat, lastBeat);
    let src = beatTimes[Math.min(b, beatTimes.length - 1)];
    if (!(src > prevSrc)) src = prevSrc + period0 * 0.01;
    if (markers.length && markers[markers.length - 1].beat === b) return;
    markers.push({ srcSec: src, beat: b });
    prevSrc = src;
  };
  for (let beat = 0; beat < lastBeat; beat += stride) push(beat);
  push(lastBeat); // endpoint
  return markers.length >= 2 ? markers : [];
}
