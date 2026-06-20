// src/samples/warp-seed-sparse.ts
// Sparse, drift-following warp-marker seed. Stage 1 tracks every beat from the
// detected tempo, snapping to nearby onsets and letting the period drift (within a
// tight band) so markers latch to where beats actually are. Stage 2 thins to one
// marker every `barsPerMarker` bars and PINS the endpoints (beat 0 and
// clipBars*beatsPerBar) so warpStretch's proportional mapping lands each marker on
// the grid.
import type { WarpMarker } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';
import { warpQuality } from './warp-quality';

// How far the per-beat period may drift from the detected tempo. The detected BPM
// is reliable (tempo is ~constant in this material), so a small band lets the
// tracker correct micro-drift while making the half-time collapse impossible:
// without it, dense half-beat subdivisions (hi-hats/claps) drag the period down to
// 0.5×, the tracker latches onto eighths as if they were quarters, covers only part
// of the audio, and the last marker stops short ("las marcas no llegan al final").
const MAX_DRIFT = 0.08;

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
    // Keep the period anchored to the detected tempo — see MAX_DRIFT. This is what
    // stops the half-time lock-in that left the last marker short.
    period = Math.min(period0 * (1 + MAX_DRIFT), Math.max(period0 * (1 - MAX_DRIFT), period));
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

/** A constant-tempo marker grid at the same sparse beats, placed straight at the
 *  detected tempo (downbeat + beat/bpm, capped at the buffer). Best when the tempo
 *  really is constant: the tracker's per-onset jitter then only smears the grid. */
export function seedConstantWarpMarkers(
  downbeatSec: number, bpm: number, durationSec: number,
  meter: TimeSignature, barsPerMarker: number, clipBars: number,
): WarpMarker[] {
  const period0 = 60 / bpm;
  const bpb = Math.max(1, Math.round(quartersPerBar(meter)));
  if (!(period0 > 0) || !(durationSec > 0) || clipBars < 1) return [];
  const anchor = Math.max(0, downbeatSec);
  const lastBeat = clipBars * bpb;
  const stride = Math.max(1, Math.round(barsPerMarker)) * bpb;
  const markers: WarpMarker[] = [];
  let prevSrc = -Infinity;
  const push = (beat: number) => {
    const b = Math.min(beat, lastBeat);
    let src = Math.min(durationSec, anchor + b * period0);
    if (!(src > prevSrc)) src = prevSrc + period0 * 0.01;
    if (markers.length && markers[markers.length - 1].beat === b) return;
    markers.push({ srcSec: src, beat: b });
    prevSrc = src;
  };
  for (let beat = 0; beat < lastBeat; beat += stride) push(beat);
  push(lastBeat);
  return markers.length >= 2 ? markers : [];
}

/** Seed warp markers, choosing PER TRACK between the drift-following tracker and a
 *  constant-tempo grid — whichever lands the detected KICKS on the beat better.
 *  The tracker wins on genuine tempo drift; the constant grid wins on steady tempo
 *  (where the tracker's per-onset jitter only hurts). `kicks` are low-band onset
 *  times (see detectKicks); with none given it falls back to the tracker. */
export function seedWarpMarkers(
  onsets: number[], kicks: number[], downbeatSec: number, bpm: number,
  durationSec: number, meter: TimeSignature, barsPerMarker: number, clipBars: number,
): WarpMarker[] {
  const tracked = seedSparseWarpMarkers(onsets, downbeatSec, bpm, durationSec, meter, barsPerMarker, clipBars);
  const constant = seedConstantWarpMarkers(downbeatSec, bpm, durationSec, meter, barsPerMarker, clipBars);
  if (tracked.length < 2) return constant;
  if (constant.length < 2 || !kicks || kicks.length === 0) return tracked;
  const qt = warpQuality(tracked, kicks, durationSec);
  const qc = warpQuality(constant, kicks, durationSec);
  return qc.alignedFrac > qt.alignedFrac ? constant : tracked;
}
