// Session view data model (Ableton-style clip grid).
// Pure types and pure helpers only — no audio side effects.

import type { BassStep, DrumStep, PolyStep } from '../core/sequencer';
import type { DrumVoice } from '../core/drums';
import type { NoteEvent } from '../core/notes';

export type LaneKind = 'bass' | 'poly' | 'drum-bus' | 'drum-lane';

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

  bassSteps?: BassStep[];
  bassNotes?: NoteEvent[];
  bassMode?: 'step' | 'piano';

  polySteps?: PolyStep[];
  polyNotes?: NoteEvent[];
  polyMode?: 'step' | 'piano';

  drumSteps?: Record<DrumVoice, DrumStep[]>;
  drumLane?: DrumVoice;
  drumLaneSteps?: DrumStep[];

  envelopes?: ClipEnvelope[];
}

export interface SessionLane {
  id: string;
  kind: LaneKind;
  clips: (SessionClip | null)[];
  expanded?: boolean;
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

export function emptyClip(lengthBars: number, kind: LaneKind, drumLane?: DrumVoice): SessionClip {
  const clip: SessionClip = { id: nextId('clip'), lengthBars };
  if (kind === 'bass')      clip.bassMode = 'piano', clip.bassNotes = [];
  else if (kind === 'poly') clip.polyMode = 'piano', clip.polyNotes = [];
  else if (kind === 'drum-bus')  clip.drumSteps = {} as Record<DrumVoice, DrumStep[]>;
  else if (kind === 'drum-lane') { clip.drumLane = drumLane; clip.drumLaneSteps = []; }
  return clip;
}

export function emptyLane(id: string, kind: LaneKind): SessionLane {
  return { id, kind, clips: [] };
}

export function emptyScene(name: string): SessionScene {
  return { id: nextId('scene'), name, clipPerLane: {} };
}

export function emptySessionState(): SessionState {
  return {
    lanes: [
      emptyLane('bass',  'bass'),
      emptyLane('drums', 'drum-bus'),
      emptyLane('main',  'poly'),
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
