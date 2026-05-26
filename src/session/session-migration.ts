// One-shot Classic → Session importer. Reads the current PatternBank and
// builds a fresh SessionState with one scene per slot, one clip per
// (lane, slot) pair.

import type { PatternBank, PatternData } from '../core/pattern';
import {
  emptyLane, emptyScene, emptySessionState,
  type SessionClip, type SessionLane, type SessionState,
} from './session';
import { bassStepsToNotes, stepsToNotes, drumStepsToNotes } from '../core/notes';
import type { NoteEvent } from '../core/notes';

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clipFromBass(pat: PatternData): SessionClip {
  const fromSteps = pat.bassMode !== 'piano' ? bassStepsToNotes(pat.bass) : [];
  const fromNotes = (pat.bassNotes ?? []).map((n) => ({ ...n }));
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: fromNotes.length ? fromNotes : fromSteps,
  };
}

function clipFromDrums(pat: PatternData): SessionClip {
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: drumStepsToNotes(pat.drums),
  };
}

function clipFromMainPoly(pat: PatternData): SessionClip {
  const fromSteps = pat.polyMode !== 'piano' ? stepsToNotes(pat.melody) : [];
  const fromNotes = (pat.polyNotes ?? []).map((n) => ({ ...n }));
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: fromNotes.length ? fromNotes : fromSteps,
  };
}

function clipFromExtra(pat: PatternData, extraId: string): SessionClip | null {
  const track = (pat.extraPolyTracks ?? []).find((t) => t.id === extraId);
  if (!track) return null;
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: track.notes.map((n) => ({ ...n })),
  };
}

export function importClassicToSession(bank: PatternBank): SessionState {
  const state = emptySessionState();

  // Collect the union of extra-poly ids used across all slots.
  const extraIds = new Set<string>();
  for (const slot of bank.slots) {
    for (const t of slot.extraPolyTracks ?? []) extraIds.add(t.id);
  }
  for (const id of extraIds) {
    state.lanes.push(emptyLane(id, 'subtractive'));
  }

  // For every slot, create a scene + one clip per lane.
  bank.slots.forEach((pat, slotIdx) => {
    const scene = emptyScene(`Scene ${slotIdx + 1}`);
    state.scenes.push(scene);

    const bassLane  = state.lanes.find((l) => l.id === 'bass')!;
    const drumsLane = state.lanes.find((l) => l.id === 'drums')!;
    const mainLane  = state.lanes.find((l) => l.id === 'main')!;

    const pushClip = (lane: SessionLane, clip: SessionClip | null): number | null => {
      if (!clip) return null;
      while (lane.clips.length < slotIdx) lane.clips.push(null);
      lane.clips[slotIdx] = clip;
      return slotIdx;
    };

    scene.clipPerLane.bass  = pushClip(bassLane,  clipFromBass(pat));
    scene.clipPerLane.drums = pushClip(drumsLane, clipFromDrums(pat));
    scene.clipPerLane.main  = pushClip(mainLane,  clipFromMainPoly(pat));
    for (const id of extraIds) {
      const lane = state.lanes.find((l) => l.id === id);
      if (lane) scene.clipPerLane[id] = pushClip(lane, clipFromExtra(pat, id));
    }
  });

  // Normalise: pad every lane to scenes.length so the grid renders uniformly.
  for (const lane of state.lanes) {
    while (lane.clips.length < state.scenes.length) lane.clips.push(null);
  }

  return state;
}

// Apply to clips that came from older saves (still have legacy fields like
// bassSteps/polySteps/drumSteps and no `notes`).
export function migrateLoadedSessionState(s: SessionState): SessionState {
  for (const lane of s.lanes) {
    delete (lane as { kind?: unknown }).kind;
    delete (lane as { expanded?: unknown }).expanded;
    if (!lane.engineId) lane.engineId = guessEngineId(lane.id);

    lane.clips = lane.clips.map((c) => c ? migrateClip(c) : null);
  }
  return s;
}

function guessEngineId(laneId: string): string {
  if (laneId === 'bass')  return 'tb303';
  if (laneId === 'drums' || laneId.startsWith('drum:')) return 'drums-machine';
  return 'subtractive';
}

function migrateClip(c: SessionClip): SessionClip {
  if (c.notes && c.notes.length >= 0) return c;
  type LegacyClip = SessionClip & {
    bassNotes?: NoteEvent[];
    polyNotes?: NoteEvent[];
    bassSteps?: import('../core/sequencer').BassStep[];
    polySteps?: import('../core/sequencer').PolyStep[];
    drumSteps?: Partial<Record<import('../core/drums').DrumVoice, import('../core/sequencer').DrumStep[]>>;
    drumLane?: import('../core/drums').DrumVoice;
    drumLaneSteps?: import('../core/sequencer').DrumStep[];
  };
  const legacy = c as LegacyClip;
  let notes: NoteEvent[] = [];
  if      (legacy.bassNotes?.length) notes = legacy.bassNotes;
  else if (legacy.polyNotes?.length) notes = legacy.polyNotes;
  else if (legacy.bassSteps)         notes = bassStepsToNotes(legacy.bassSteps);
  else if (legacy.polySteps)         notes = stepsToNotes(legacy.polySteps);
  else if (legacy.drumSteps)         notes = drumStepsToNotes(legacy.drumSteps);
  else if (legacy.drumLaneSteps && legacy.drumLane) {
    notes = drumStepsToNotes({ [legacy.drumLane]: legacy.drumLaneSteps });
  }
  return {
    id: c.id, name: c.name, color: c.color,
    lengthBars: c.lengthBars, launchQuantize: c.launchQuantize,
    envelopes: c.envelopes, notes,
  };
}
