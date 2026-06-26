// src/core/scene-loop-link.ts
// Pure helpers for the scene LINK feature: propagating a clip's local loop
// region to every other clip in the same scene.
//
// Scene LINK model: when a scene's loopLinked flag is true, editing the loop
// on any clip copies loopEnabled/loopStartTick/loopEndTick to every clip in the
// scene, clamped per target clip's own length. On unlink each clip keeps its
// current loop unchanged.
//
// This module is PURE (no DOM, no audio). The host wires calls into it; the
// overlay calls the host after each commit. The scheduler and local-loop path
// are untouched — this only writes clip fields, which tickLane already reads.

import type { SessionClip, SessionLane, SessionScene, SessionState } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';

export interface LoopSource {
  loopEnabled?: boolean;
  loopStartTick?: number;
  loopEndTick?: number;
}

/** Resolve which clip a lane plays in a given scene.
 *  Mirrors the `hasExplicit ? clipPerLane[laneId] : sceneIdx` logic in
 *  session-runtime.ts `launchScene` exactly. Returns null when the lane has
 *  no clip for that scene. */
export function resolveSceneClip(
  scene: SessionScene,
  sceneIdx: number,
  lane: SessionLane,
): SessionClip | null {
  const hasExplicit = Object.prototype.hasOwnProperty.call(scene.clipPerLane, lane.id);
  const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;
  if (idx == null) return null;
  return lane.clips[idx] ?? null;
}

/** Copy a loop region from `src` to `dst`, clamping start/end to the
 *  destination clip's own tick length. Safe for clips of different lengths. */
export function copyLoopToClip(
  src: LoopSource,
  dst: SessionClip,
  meter: TimeSignature,
): void {
  const total = dst.lengthBars * ticksPerBar(meter);
  dst.loopEnabled = !!src.loopEnabled;
  dst.loopStartTick = Math.max(0, Math.min(src.loopStartTick ?? 0, total));
  dst.loopEndTick   = Math.max(0, Math.min(src.loopEndTick   ?? total, total));
}

/** Propagate the loop from `srcClip` to every clip in `scene` that belongs to
 *  a lane in `state`, using the correct clip-resolution strategy.
 *  `sceneIdx` must be the index of `scene` in `state.scenes`.
 *  The srcClip itself is skipped (its loop is already set).
 *  Clips from a DIFFERENT scene are never touched (they are not iterated). */
export function propagateLoopToSceneClips(
  state: SessionState,
  scene: SessionScene,
  sceneIdx: number,
  srcClip: SessionClip,
  meter: TimeSignature,
): void {
  for (const lane of state.lanes) {
    const clip = resolveSceneClip(scene, sceneIdx, lane);
    if (!clip || clip === srcClip) continue;
    copyLoopToClip(srcClip, clip, meter);
  }
}
