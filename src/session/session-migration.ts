// Load-time normaliser for SessionState. Runs on every load (save file,
// autosave, demo JSON) and backfills fields that older formats are
// missing — engine ids, modern `notes` array from legacy step formats,
// and a stable palette color.

import { CLIP_COLOR_PALETTE, DEFAULT_MUSICALITY, type SessionClip, type SessionState } from './session';
import { bassStepsToNotes, stepsToNotes, drumStepsToNotes } from '../core/notes';
import type { NoteEvent } from '../core/notes';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';

export function migrateLoadedSessionState(s: SessionState): SessionState {
  for (const lane of s.lanes) {
    delete (lane as { kind?: unknown }).kind;
    delete (lane as { expanded?: unknown }).expanded;
    if (!lane.engineId) lane.engineId = guessEngineId(lane.id);

    lane.clips = lane.clips.map((c) => c ? migrateClip(c) : null);
  }
  if (!s.musicality) s.musicality = { ...DEFAULT_MUSICALITY };
  // Scale lock is opt-in per working session: never load a session with it
  // already ON, even if an old save persisted lock:true. The user re-enables
  // it from the tonality bar when they want it.
  s.musicality.lock = false;
  return s;
}

/** Deterministic palette pick from a clip id — same id always yields the
 *  same color, so demos load with stable colors across page reloads. */
function colorForClipId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CLIP_COLOR_PALETTE[Math.abs(hash) % CLIP_COLOR_PALETTE.length];
}

function guessEngineId(laneId: string): string {
  if (laneId === 'bass')  return 'tb303';
  if (laneId === 'drums' || laneId.startsWith('drum:')) return 'drums-machine';
  return 'subtractive';
}

function migrateClip(c: SessionClip): SessionClip {
  // Modern clip: only backfill the color if it was missing (e.g. demo JSONs
  // that predate the color field, or save files from before the palette).
  if (Array.isArray(c.notes)) {
    // Backfill gridResolution so the editor's first open doesn't mutate the clip
    // and accidentally create a spurious undo entry via AutoHistory's diff check.
    const withColor: SessionClip = c.color ? c : { ...c, color: colorForClipId(c.id) };
    return withColor.gridResolution ? withColor : { ...withColor, gridResolution: DEFAULT_RESOLUTION };
  }
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
    id: c.id, name: c.name, color: c.color ?? colorForClipId(c.id),
    lengthBars: c.lengthBars, launchQuantize: c.launchQuantize,
    envelopes: c.envelopes, notes,
  };
}
