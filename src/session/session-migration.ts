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

/** Carry pattern-level automation lanes into the per-clip envelope field,
 *  filtered to entries whose paramId belongs to this clip's lane. The
 *  automation registry uses the convention `<laneId>.<spec.id>`, so a
 *  startsWith match on `<laneId>.` is the canonical routing rule. */
function envelopesForLane(pat: PatternData, laneId: string): import('./session').ClipEnvelope[] | undefined {
  const lanes = (pat.automation ?? []).filter((a) => a.paramId.startsWith(`${laneId}.`));
  if (lanes.length === 0) return undefined;
  return lanes.map((a) => ({
    paramId: a.paramId,
    values:  [...a.values],
    enabled: a.enabled,
    stepped: a.stepped,
  }));
}

function clipFromBass(pat: PatternData): SessionClip {
  const fromSteps = pat.bassMode !== 'piano' ? bassStepsToNotes(pat.bass) : [];
  const fromNotes = (pat.bassNotes ?? []).map((n) => ({ ...n }));
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: fromNotes.length ? fromNotes : fromSteps,
    envelopes: envelopesForLane(pat, 'tb-303-1'),
  };
}

function clipFromDrums(pat: PatternData): SessionClip {
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: drumStepsToNotes(pat.drums),
    envelopes: envelopesForLane(pat, 'drums-1'),
  };
}

function clipFromMainPoly(pat: PatternData): SessionClip {
  const fromSteps = pat.polyMode !== 'piano' ? stepsToNotes(pat.melody) : [];
  const fromNotes = (pat.polyNotes ?? []).map((n) => ({ ...n }));
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: fromNotes.length ? fromNotes : fromSteps,
    envelopes: envelopesForLane(pat, 'subtractive-1'),
  };
}

function clipFromExtra(pat: PatternData, extraId: string): SessionClip | null {
  const track = (pat.extraPolyTracks ?? []).find((t) => t.id === extraId);
  if (!track) return null;
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: track.notes.map((n) => ({ ...n })),
    envelopes: envelopesForLane(pat, extraId),
  };
}

export function importClassicToSession(bank: PatternBank): SessionState {
  const state = emptySessionState();

  // Collect the union of extra-poly ids used across all slots. Legacy ids
  // (`poly1`, `poly2`, …) are mapped to the new slug scheme (`subtractive-2`,
  // `subtractive-3`, …) so loaded state matches what the rest of the code
  // expects.
  const extraIdsLegacy = new Set<string>();
  for (const slot of bank.slots) {
    for (const t of slot.extraPolyTracks ?? []) extraIdsLegacy.add(t.id);
  }
  const extraIdMap = new Map<string, string>();
  let polyCount = 1; // `subtractive-1` already counts as the first poly lane.
  for (const legacy of extraIdsLegacy) {
    polyCount++;
    const slug = `subtractive-${polyCount}`;
    extraIdMap.set(legacy, slug);
    const lane = emptyLane(slug, 'subtractive');
    lane.name = `Subtractive ${polyCount}`;
    state.lanes.push(lane);
  }

  // For every slot, create a scene + one clip per lane.
  bank.slots.forEach((pat, slotIdx) => {
    const scene = emptyScene(`Scene ${slotIdx + 1}`);
    state.scenes.push(scene);

    const bassLane  = state.lanes.find((l) => l.id === 'tb-303-1')!;
    const drumsLane = state.lanes.find((l) => l.id === 'drums-1')!;
    const mainLane  = state.lanes.find((l) => l.id === 'subtractive-1')!;

    const pushClip = (lane: SessionLane, clip: SessionClip | null): number | null => {
      if (!clip) return null;
      while (lane.clips.length < slotIdx) lane.clips.push(null);
      lane.clips[slotIdx] = clip;
      return slotIdx;
    };

    scene.clipPerLane['tb-303-1']      = pushClip(bassLane,  clipFromBass(pat));
    scene.clipPerLane['drums-1']       = pushClip(drumsLane, clipFromDrums(pat));
    scene.clipPerLane['subtractive-1'] = pushClip(mainLane,  clipFromMainPoly(pat));
    for (const legacyId of extraIdsLegacy) {
      const slug = extraIdMap.get(legacyId)!;
      const lane = state.lanes.find((l) => l.id === slug);
      if (lane) scene.clipPerLane[slug] = pushClip(lane, clipFromExtra(pat, legacyId));
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
  if (Array.isArray(c.notes)) return c;
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
