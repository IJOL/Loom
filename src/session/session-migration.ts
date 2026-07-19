// Load-time normaliser for SessionState. Runs on every load (save file,
// autosave, demo JSON) and backfills fields older formats may be missing —
// a stable palette color, default FX sends. It also mints stable insert-slot
// ids for slots that predate the id field.

import { CLIP_COLOR_PALETTE, DEFAULT_MUSICALITY, type SessionClip, type SessionState } from './session';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { defaultSends } from '../core/send-migration';
import { backfillInsertIds } from './insert-slot';

export function migrateLoadedSessionState(s: SessionState): SessionState {
  for (const lane of s.lanes) {
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
  // Insert identity: mint an id for any slot saved before ids existed, so a
  // destination naming it never collides with `undefined`. Must run AFTER the
  // sends are seeded (they carry a rack of their own).
  backfillInsertIds(s.masterInserts);
  for (const bus of s.sends ?? []) backfillInsertIds(bus.inserts);
  for (const lane of s.lanes) backfillInsertIds(lane.inserts);
  return s;
}

/** Deterministic palette pick from a clip id — same id always yields the
 *  same color, so demos load with stable colors across page reloads. */
function colorForClipId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CLIP_COLOR_PALETTE[Math.abs(hash) % CLIP_COLOR_PALETTE.length];
}

function migrateClip(c: SessionClip): SessionClip {
  // Only backfill the color if it was missing (e.g. demo JSONs that predate
  // the color field, or save files from before the palette).
  // Backfill gridResolution so the editor's first open doesn't mutate the clip
  // and accidentally create a spurious undo entry via AutoHistory's diff check.
  const withColor: SessionClip = c.color ? c : { ...c, color: colorForClipId(c.id) };
  return withColor.gridResolution ? withColor : { ...withColor, gridResolution: DEFAULT_RESOLUTION };
}
