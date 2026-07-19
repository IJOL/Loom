// Load-time normaliser for SessionState. Runs on every load (save file,
// autosave, demo JSON) and backfills fields that older formats are
// missing — engine ids, modern `notes` array from legacy step formats,
// and a stable palette color. It also mints the stable insert-slot ids and
// repoints every stored automation/modulation destination that still names an
// insert by its position in the rack (see "Insert identity" below).

import { CLIP_COLOR_PALETTE, DEFAULT_MUSICALITY, type SessionClip, type SessionState } from './session';
import { bassStepsToNotes, stepsToNotes, drumStepsToNotes } from '../core/notes';
import type { NoteEvent } from '../core/notes';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { defaultSends, remapLaneSendParams } from '../core/send-migration';
import { backfillInsertIds, type InsertSlot } from './insert-slot';
import { parseLegacyInsertParamId } from '../automation/automation-apply';
import { insertParamId } from '../automation/automation-targets';
import type { ArrangementState } from '../performance/performance';

export function migrateLoadedSessionState(s: SessionState): SessionState {
  for (const lane of s.lanes) {
    delete (lane as { kind?: unknown }).kind;
    delete (lane as { expanded?: unknown }).expanded;
    if (!lane.engineId) lane.engineId = guessEngineId(lane.id);

    // Canonical preset vocabulary: every built-in / JSON preset is `engine:<name>`
    // for ALL engines. Older saves + demos (and imported melodic lanes) stored
    // subtractive factory presets as `factory:<name>`; fold them into `engine:`
    // here — ONCE, at load — so nothing downstream re-prefixes. (The dropped-
    // subtractive-preset bug came from a per-record `factory:`→`engine:` transform
    // that didn't match subtractive's factory: options.) `user:` (subtractive
    // localStorage) and `sampler:` (async refs) are genuinely different → untouched.
    if (lane.enginePresetName?.startsWith('factory:')) {
      lane.enginePresetName = `engine:${lane.enginePresetName.slice('factory:'.length)}`;
    }

    lane.clips = lane.clips.map((c) => c ? migrateClip(c) : null);
  }
  if (!s.name) s.name = 'Untitled';
  if (!s.musicality) s.musicality = { ...DEFAULT_MUSICALITY };
  // Scale lock is opt-in per working session: never load a session with it
  // already ON, even if an old save persisted lock:true. The user re-enables
  // it from the tonality bar when they want it.
  s.musicality.lock = false;
  // FX sends: seed the two default buses if absent (old saves predate them).
  if (!s.sends) s.sends = defaultSends();
  // Insert identity: mint missing slot ids, then repoint every stored
  // destination that still addresses a slot by position. Must run AFTER the
  // sends are seeded (they carry a rack of their own) and BEFORE anything
  // reads a destination id.
  normaliseInsertIdentity(s);
  // Remap legacy per-lane send knob ids (mix.<lane>.rev/.dly → .sendB/.sendA).
  for (const lane of s.lanes) {
    if (lane.engineState?.params) {
      lane.engineState.params = remapLaneSendParams(lane.engineState.params);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Insert identity: position → stable id
//
// Destinations used to name an insert by its POSITION in the rack, in two
// unrelated shapes: automation/envelopes stored `<scope>.fx<idx>.<param>` (the
// scope is inside the id and may itself be dotted, e.g. `fx.send.A`), while
// modulation stored `lane-insert-<idx>:<param>` / `master-insert-<idx>:<param>`
// (no scope at all — `lane-` meant the lane owning the modulator). Load is the
// only moment the stored index still means what it meant at save time, so the
// translation happens here, once, before anything resolves an id.
// ---------------------------------------------------------------------------

/** Resolve a scope id to its slot list, so a legacy positional id can be
 *  mapped onto the slot that occupied that position at save time. */
function slotsForScope(s: SessionState, scopeId: string): InsertSlot[] | undefined {
  if (scopeId === 'fx.master') return s.masterInserts;
  if (scopeId.startsWith('fx.send.')) {
    return s.sends?.find((b) => b.id === scopeId.slice('fx.send.'.length))?.inserts;
  }
  return s.lanes.find((l) => l.id === scopeId)?.inserts;
}

/** Translate one stored destination id into the canonical stable-id form.
 *  Handles both legacy shapes; returns the id unchanged when already canonical,
 *  when it is a plain engine param, or when the slot it named no longer exists.
 *  `laneId` supplies the scope the scope-less modulation form omits. */
function canonicaliseDestinationId(s: SessionState, laneId: string, id: string): string {
  // Legacy modulation form: `lane-insert-<idx>:<param>` / `master-insert-<idx>:<param>`.
  const mod = /^(lane|master)-insert-(\d+):(.+)$/.exec(id);
  if (mod) {
    const scopeId = mod[1] === 'master' ? 'fx.master' : laneId;
    const slot = slotsForScope(s, scopeId)?.[Number(mod[2])];
    return slot ? insertParamId(scopeId, slot.id, mod[3]) : id;
  }
  // Legacy automation form: `<scope>.fx<idx>.<param>`. A canonical id carries
  // `fx:<slotId>` instead, which this parser rejects — so it is idempotent.
  const legacy = parseLegacyInsertParamId(id);
  if (legacy) {
    const slot = slotsForScope(s, legacy.scopeId)?.[legacy.slotIdx];
    return slot ? insertParamId(legacy.scopeId, slot.id, legacy.paramId) : id;
  }
  return id;
}

/** Backfill slot ids everywhere, then repoint every stored destination id.
 *  Order is load-bearing: translation maps `slotIdx → slots[slotIdx].id`, so a
 *  slot without an id yet would be mapped onto `undefined`. */
function normaliseInsertIdentity(s: SessionState): void {
  backfillInsertIds(s.masterInserts);
  for (const bus of s.sends ?? []) backfillInsertIds(bus.inserts);
  for (const lane of s.lanes) backfillInsertIds(lane.inserts);

  for (const lane of s.lanes) {
    for (const mod of lane.engineState?.modulators ?? []) {
      for (const conn of mod.connections ?? []) {
        conn.paramId = canonicaliseDestinationId(s, lane.id, conn.paramId);
      }
    }
    for (const clip of lane.clips ?? []) {
      for (const env of clip?.envelopes ?? []) {
        env.paramId = canonicaliseDestinationId(s, lane.id, env.paramId);
      }
    }
  }
}

/** Performance-view automation curves live in `SavedStateV3.arrangement`, not in
 *  SessionState, so `migrateLoadedSessionState` never reaches them — but they
 *  record the same knob ids and go equally inert if left positional. Call this
 *  with an ALREADY-migrated session (slot ids backfilled). Only the automation
 *  shape occurs here: curves are keyed by the knob id, never by the scope-less
 *  modulation form. */
export function canonicaliseArrangementParamIds(s: SessionState, arr: ArrangementState): void {
  for (const rec of arr.lanes ?? []) {
    for (const curve of rec.automation ?? []) {
      curve.paramId = canonicaliseDestinationId(s, rec.laneId, curve.paramId);
    }
  }
  for (const curve of arr.globalAutomation ?? []) {
    curve.paramId = canonicaliseDestinationId(s, '', curve.paramId);
  }
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
