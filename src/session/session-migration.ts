// Load-time normaliser for SessionState. Runs on every load (save file,
// autosave, demo JSON) and backfills fields older formats may be missing —
// a stable palette color, default FX sends.

import { CLIP_COLOR_PALETTE, DEFAULT_MUSICALITY, type SessionClip, type SessionState } from './session';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { defaultSends } from '../core/send-migration';

export function migrateLoadedSessionState(s: SessionState): SessionState {
  for (const lane of s.lanes) {
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
