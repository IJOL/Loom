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

let nextIdCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(nextIdCounter++).toString(36)}`;
}

export function emptyClip(lengthBars: number): SessionClip {
  return { id: nextId('clip'), lengthBars, notes: [] };
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
