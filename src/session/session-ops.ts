// Session mutation + query ops (clip move/copy, lane/scene duplicate + delete,
// envelope reconciliation, clip-context resolution). Split out of session.ts to
// keep each module under the size budget. Pure — no audio side effects.

import { nextId, cloneSessionState } from './session-core';
import type { SessionClip, SessionLane, SessionScene, SessionState } from './session-types';

export interface ClipSlot { laneId: string; clipIdx: number; }

export function canDropClip(s: SessionState, from: ClipSlot, to: ClipSlot): boolean {
  if (from.laneId === to.laneId && from.clipIdx === to.clipIdx) return false;
  const srcLane = s.lanes.find((l) => l.id === from.laneId);
  if (!srcLane) return false;
  const srcClip = srcLane.clips[from.clipIdx];
  if (!srcClip) return false;
  const dstLane = s.lanes.find((l) => l.id === to.laneId);
  if (!dstLane) return false;
  const dstClip = dstLane.clips[to.clipIdx];
  return dstClip == null;
}

function padToIndex<T>(arr: (T | null)[], idx: number): (T | null)[] {
  if (arr.length > idx) return arr;
  return [...arr, ...Array(idx - arr.length + 1).fill(null)];
}

function reEvaluateEnvelopes(
  clip: SessionClip,
  destEngineParamIds: ReadonlySet<string>,
): SessionClip {
  if (!clip.envelopes || clip.envelopes.length === 0) return clip;
  return {
    ...clip,
    envelopes: clip.envelopes.map((env) => ({
      ...env,
      values: [...env.values],
      enabled: destEngineParamIds.has(env.paramId),
    })),
  };
}

/** After a lane's engine changes, re-evaluate every clip's automation
 *  envelopes against the new engine's param set: an envelope whose paramId
 *  is absent from `paramIds` is disabled (kept, not deleted — mirrors
 *  reEvaluateEnvelopes used by moveClip/copyClip). Mutates the lane in place. */
export function reconcileLaneEnvelopes(
  lane: SessionLane,
  paramIds: ReadonlySet<string>,
): void {
  for (const clip of lane.clips) {
    if (!clip?.envelopes) continue;
    for (const env of clip.envelopes) {
      env.enabled = paramIds.has(env.paramId);
    }
  }
}

export function moveClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
  destEngineParamIds: ReadonlySet<string>,
): SessionState {
  if (!canDropClip(s, from, to)) {
    throw new Error(`moveClip: invalid drop from ${from.laneId}:${from.clipIdx} to ${to.laneId}:${to.clipIdx}`);
  }
  const out = cloneSessionState(s);
  const srcLane = out.lanes.find((l) => l.id === from.laneId)!;
  const dstLane = out.lanes.find((l) => l.id === to.laneId)!;
  const movingClip = srcLane.clips[from.clipIdx]!;
  srcLane.clips[from.clipIdx] = null;
  dstLane.clips = padToIndex(dstLane.clips, to.clipIdx);
  dstLane.clips[to.clipIdx] = from.laneId === to.laneId
    ? movingClip
    : reEvaluateEnvelopes(movingClip, destEngineParamIds);
  return out;
}

export function copyClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
  destEngineParamIds: ReadonlySet<string>,
): SessionState {
  if (!canDropClip(s, from, to)) {
    throw new Error(`copyClip: invalid drop from ${from.laneId}:${from.clipIdx} to ${to.laneId}:${to.clipIdx}`);
  }
  const out = cloneSessionState(s);
  const srcLane = out.lanes.find((l) => l.id === from.laneId)!;
  const dstLane = out.lanes.find((l) => l.id === to.laneId)!;
  const source = srcLane.clips[from.clipIdx]!;
  // cloneSessionState already deep-cloned `source`; just give the copy a new id.
  const clone: SessionClip = {
    ...source,
    id: nextId('clip'),
    // Deep-clone envelopes to prevent edits to the copy affecting the source
    envelopes: source.envelopes
      ? source.envelopes.map((env) => ({ ...env, values: [...env.values] }))
      : undefined,
  };
  dstLane.clips = padToIndex(dstLane.clips, to.clipIdx);
  dstLane.clips[to.clipIdx] = from.laneId === to.laneId
    ? clone
    : reEvaluateEnvelopes(clone, destEngineParamIds);
  return out;
}

/** Full-clone a lane (instrument + all clips) and insert it immediately to the
 *  right of the source. Clips get fresh ids (ids must be unique across the
 *  session). Explicit clipPerLane entries pointing at the source lane are
 *  mirrored onto the new lane in every scene; scenes that use row-index
 *  fallback need no change (the cloned clips sit at the same row indices). */
export function duplicateLane(state: SessionState, srcLaneId: string, newId: string): SessionLane {
  const srcIndex = state.lanes.findIndex((l) => l.id === srcLaneId);
  if (srcIndex < 0) throw new Error(`duplicateLane: no lane ${srcLaneId}`);
  const src = state.lanes[srcIndex];
  const clone: SessionLane = JSON.parse(JSON.stringify(src));
  clone.id = newId;
  clone.name = `${src.name ?? src.id} copy`;
  clone.clips = clone.clips.map((c) => (c ? { ...c, id: nextId('clip') } : null));
  state.lanes.splice(srcIndex + 1, 0, clone);
  for (const scene of state.scenes) {
    if (Object.prototype.hasOwnProperty.call(scene.clipPerLane, srcLaneId)) {
      scene.clipPerLane[newId] = scene.clipPerLane[srcLaneId];
    }
  }
  return clone;
}

/** Clone a scene and append it at the end. clipPerLane is fully resolved for
 *  every lane (explicit value, else the source row index) so the clone launches
 *  exactly what the source launches regardless of its new row position. New
 *  scenes are appended (never spliced) so row-index-fallback scenes stay aligned. */
export function duplicateScene(state: SessionState, sceneIdx: number): SessionScene | null {
  const src = state.scenes[sceneIdx];
  if (!src) return null;
  const clipPerLane: Record<string, number | null> = {};
  for (const lane of state.lanes) {
    const explicit = Object.prototype.hasOwnProperty.call(src.clipPerLane, lane.id);
    clipPerLane[lane.id] = explicit ? src.clipPerLane[lane.id] : sceneIdx;
  }
  const scene: SessionScene = {
    id: nextId('scene'),
    name: `${src.name ?? `Scene ${sceneIdx + 1}`} copy`,
    clipPerLane,
  };
  state.scenes.push(scene);
  return scene;
}

// ── Deletion helpers (front A · session management) ──────────────────────────

/** Empty a single cell (set null), keeping the column length. NOT a splice. */
export function deleteClipAt(lane: SessionLane, clipIdx: number): void {
  if (clipIdx >= 0 && clipIdx < lane.clips.length) lane.clips[clipIdx] = null;
}

/** Remove a whole lane + its references in every scene's clipPerLane. Does not
 *  touch audio resources (the host disposes those separately). */
export function deleteLane(state: SessionState, laneId: string): void {
  const i = state.lanes.findIndex((l) => l.id === laneId);
  if (i < 0) return;
  state.lanes.splice(i, 1);
  for (const scene of state.scenes) delete scene.clipPerLane[laneId];
}

/** True if the lane holds any clip (used to decide whether to confirm deletion). */
export function laneHasContent(lane: SessionLane): boolean {
  return lane.clips.some((c) => c != null);
}

/** True if deleting this scene row would lose anything launchable: a clip on that
 *  row in any lane, OR a scene's explicit clipPerLane mapping pointing at that row
 *  (addNoteLane / stems / MIDI import create such explicit mappings). */
export function sceneHasContent(state: SessionState, sceneIdx: number): boolean {
  if (state.lanes.some((l) => l.clips[sceneIdx] != null)) return true;
  for (const scene of state.scenes) {
    for (const [laneId, row] of Object.entries(scene.clipPerLane)) {
      if (row !== sceneIdx) continue;
      const lane = state.lanes.find((l) => l.id === laneId);
      if (lane?.clips[row] != null) return true;
    }
  }
  return false;
}

/** Remove a scene row, COMPACTING the clip columns (scene launch is positional —
 *  session-runtime.ts launchScene uses the row index — so a non-compacting delete
 *  would pair surviving scenes with the wrong clips). Reindexes explicit
 *  clipPerLane mappings: row===idx is dropped, row>idx decrements. */
export function deleteScene(state: SessionState, sceneIdx: number): void {
  if (sceneIdx < 0 || sceneIdx >= state.scenes.length) return;
  state.scenes.splice(sceneIdx, 1);
  for (const lane of state.lanes) {
    if (sceneIdx < lane.clips.length) lane.clips.splice(sceneIdx, 1);
  }
  for (const scene of state.scenes) {
    for (const [laneId, row] of Object.entries(scene.clipPerLane)) {
      if (row == null) continue;
      if (row === sceneIdx) delete scene.clipPerLane[laneId];
      else if (row > sceneIdx) scene.clipPerLane[laneId] = row - 1;
    }
  }
}

/** Resolve the display context for a clip at (laneId, clipIdx): the track,
 *  scene (the scene on the clip's OWN row — matches default scene launch), row
 *  number, and the three display names with their fallbacks. Pure; returns null
 *  when the lane or clip is absent. Used by the inspector's context breadcrumb. */
export function resolveClipContext(
  state: SessionState,
  laneId: string,
  clipIdx: number,
): {
  lane: SessionLane;
  clip: SessionClip;
  trackName: string;
  sceneName: string;
  rowNumber: number;
  clipName: string;
} | null {
  const lane = state.lanes.find((l) => l.id === laneId);
  const clip = lane?.clips[clipIdx];
  if (!lane || !clip) return null;
  // `?.` guards against test fixtures that omit `scenes`; production always has it.
  const scene = state.scenes?.[clipIdx];
  return {
    lane,
    clip,
    trackName: lane.name ?? lane.id.toUpperCase(),
    sceneName: scene?.name ?? `Scene ${clipIdx + 1}`,
    rowNumber: clipIdx + 1,
    clipName: clip.name ?? `Clip ${clipIdx + 1}`,
  };
}
