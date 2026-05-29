// Session view data model (Ableton-style clip grid).
// Pure types and pure helpers only — no audio side effects.

import type { NoteEvent } from '../core/notes';

export type LaunchQuantize =
  | 'immediate' | '1/4' | '1/2' | '1/1' | '2/1' | '4/1';

export interface ClipEnvelope {
  paramId: string;
  values: number[];
  enabled?: boolean;
  stepped?: boolean;
}

export interface SessionClip {
  id: string;
  name?: string;
  color?: string;
  lengthBars: number;
  launchQuantize?: LaunchQuantize;
  notes: NoteEvent[];
  envelopes?: ClipEnvelope[];
}

export interface SessionLane {
  id: string;
  engineId: string;
  name?: string;
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
  };
  /** Currently applied preset name for this lane (`factory:Name` /
   *  `user:Name` / `engine:Name` — same shape as `polyPresetName` values). */
  enginePresetName?: string;
}

export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;
  /** Optional per-lane preset to apply when this scene is launched.
   *  Keyed by laneId, value uses the same shape as `polyPresetName`
   *  (`factory:Name` / `user:Name` / `engine:Name`). */
  presetPerLane?: Record<string, string>;
}

export interface SessionState {
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export const CLIP_COLOR_PALETTE: readonly string[] = [
  '#f4b8b8', '#f4c8a8', '#f4e0a8', '#d8e8a8',
  '#a8e8b8', '#a8e0d8', '#a8c8e8', '#b8b8e8',
  '#c8a8e0', '#e0a8d0', '#e0b8b8', '#c8c8a8',
];

export function pickRandomClipColor(rng: () => number = Math.random): string {
  const i = Math.min(CLIP_COLOR_PALETTE.length - 1, Math.floor(rng() * CLIP_COLOR_PALETTE.length));
  return CLIP_COLOR_PALETTE[i];
}

let nextIdCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(nextIdCounter++).toString(36)}`;
}

export function emptyClip(lengthBars: number): SessionClip {
  return { id: nextId('clip'), lengthBars, notes: [], color: pickRandomClipColor() };
}

export function emptyLane(id: string, engineId: string): SessionLane {
  return { id, engineId, clips: [] };
}

export function emptyScene(name: string): SessionScene {
  return { id: nextId('scene'), name, clipPerLane: {} };
}

export function emptySessionState(): SessionState {
  return {
    lanes: [
      { id: 'tb-303-1',      engineId: 'tb303',          name: '303 1',   clips: [] },
      { id: 'drums-1',       engineId: 'drums-machine',  name: 'Drums 1', clips: [] },
      { id: 'subtractive-1', engineId: 'subtractive',    name: 'Sub 1',   clips: [] },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

export function cloneSessionState(s: SessionState): SessionState {
  return JSON.parse(JSON.stringify(s)) as SessionState;
}

export function clipRowCount(s: SessionState): number {
  let maxClips = 0;
  for (const lane of s.lanes) maxClips = Math.max(maxClips, lane.clips.length);
  return Math.max(maxClips, s.scenes.length);
}

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
