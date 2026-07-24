// Load-time normaliser for SessionState. Runs on every load (save file,
// autosave, demo JSON).
//
// The fields below are required in the types and constructed at every
// construction site since 2026-07-19 (commit 6bf2446) — but save FILES written
// by older builds still exist in Downloads/localStorage without them. This is
// the one boundary where that foreign JSON becomes a spec-true SessionState;
// a missing rack must become [] HERE, or every destinations.list() call dies
// ("slots is not iterable") and the lane editor aborts before mounting its
// insert panel and preset dropdowns.

import { CLIP_COLOR_PALETTE, DEFAULT_MUSICALITY, type SessionClip, type SessionState } from './session';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { defaultSends } from '../core/send-migration';

export function migrateLoadedSessionState(s: SessionState): SessionState {
  if (!s.name) s.name = 'Untitled';
  if (!s.musicality) s.musicality = { ...DEFAULT_MUSICALITY };
  // Scale lock is opt-in per working session: never load a session with it
  // already ON, even if a save persisted lock:true. The user re-enables it
  // from the tonality bar when they want it. Deliberate policy, not a
  // missing-field backfill.
  s.musicality.lock = false;
  s.masterInserts ??= [];
  if (!s.sends) s.sends = defaultSends();
  for (const bus of s.sends) bus.inserts ??= [];
  for (const lane of s.lanes) {
    lane.inserts ??= [];
    lane.clips = lane.clips.map((c) => (c ? migrateClip(c) : null));
  }
  return s;
}

/** Deterministic palette pick from a clip id — same id always yields the
 *  same color, so old saves load with stable colors across page reloads. */
function colorForClipId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CLIP_COLOR_PALETTE[Math.abs(hash) % CLIP_COLOR_PALETTE.length];
}

function migrateClip(c: SessionClip): SessionClip {
  // Backfill color so pre-palette clips don't render unstyled, and
  // gridResolution so the editor's first open doesn't mutate the clip and
  // create a spurious undo entry via AutoHistory's diff check.
  const withColor: SessionClip = c.color ? c : { ...c, color: colorForClipId(c.id) };
  return withColor.gridResolution ? withColor : { ...withColor, gridResolution: DEFAULT_RESOLUTION };
}
