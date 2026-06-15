// src/session/warp-marker-edit.ts
// Pure operations over a clip's warp markers + propagation to grouped stems.
// Endpoints (first/last marker) are protected: their `beat` is the grid frame
// warpStretch normalizes against, so they must survive every edit.
import type { SessionState, WarpMarker } from './session';

const EPS = 1e-4;

export function moveMarker(markers: WarpMarker[], index: number, srcSec: number): WarpMarker[] {
  if (index < 0 || index >= markers.length) return markers;
  const lo = index > 0 ? markers[index - 1].srcSec : -Infinity;
  const hi = index < markers.length - 1 ? markers[index + 1].srcSec : Infinity;
  const clamped = Math.min(Math.max(srcSec, lo + EPS), hi - EPS);
  const next = markers.slice();
  next[index] = { ...markers[index], srcSec: clamped };
  return next;
}

export function addMarker(markers: WarpMarker[], srcSec: number, beat: number): WarpMarker[] {
  if (markers.some((x) => x.beat === beat || Math.abs(x.srcSec - srcSec) < EPS)) return markers;
  return [...markers, { srcSec, beat }].sort((a, b) => a.srcSec - b.srcSec);
}

export function deleteMarker(markers: WarpMarker[], index: number): WarpMarker[] {
  if (index <= 0 || index >= markers.length - 1) return markers; // endpoints protected
  return markers.filter((_, i) => i !== index);
}

/** Write `markers` (cloned) + `warp` onto every clip sample whose warpGroupId
 *  matches. Returns the affected sampleIds (for cache invalidation). */
export function propagateWarp(state: SessionState, groupId: string, markers: WarpMarker[], warp: boolean): string[] {
  const affected: string[] = [];
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!s || s.warpGroupId !== groupId) continue;
      s.warpMarkers = markers.map((x) => ({ ...x }));
      s.warp = warp;
      affected.push(s.sampleId);
    }
  }
  return affected;
}

/** Apply a loop sub-region to EVERY clip whose sample shares `groupId` — the
 *  "paint a loop across all channels of this song at once" gesture. The loop
 *  fields live on the clip (loopEnabled/loopStartTick/loopEndTick) while the
 *  grouping key (warpGroupId) lives on the sample; all stems of one import share
 *  the same lengthBars, so the tick bounds map 1:1 across them. Returns affected
 *  sampleIds (so the caller can invalidate each warp-cache entry). */
export function propagateLoop(
  state: SessionState,
  groupId: string,
  loopEnabled: boolean,
  loopStartTick: number,
  loopEndTick: number,
): string[] {
  const affected: string[] = [];
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!clip || !s || s.warpGroupId !== groupId) continue;
      clip.loopEnabled = loopEnabled;
      clip.loopStartTick = loopStartTick;
      clip.loopEndTick = loopEndTick;
      affected.push(s.sampleId);
    }
  }
  return affected;
}
