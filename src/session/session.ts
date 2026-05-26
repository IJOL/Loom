// Session view data model (Ableton-style clip grid).
// Pure types and pure helpers only — no audio side effects.

import type { NoteEvent } from '../core/notes';

export type LaunchQuantize =
  | 'immediate' | '1/4' | '1/2' | '1/1' | '2/1' | '4/1';

export interface ClipEnvelope {
  paramId: string;
  values: number[];
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
}

export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;
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
      { id: 'bass',  engineId: 'tb303',          name: 'TB-303 1',      clips: [] },
      { id: 'drums', engineId: 'drums-machine',  name: 'Drums 1',       clips: [] },
      { id: 'main',  engineId: 'subtractive',    name: 'Subtractive 1', clips: [] },
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
