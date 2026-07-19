// Load-time normaliser for SessionState. Runs on every load (save file,
// autosave, demo JSON).

import type { SessionState } from './session';

export function migrateLoadedSessionState(s: SessionState): SessionState {
  // Scale lock is opt-in per working session: never load a session with it
  // already ON, even if a save persisted lock:true. The user re-enables it
  // from the tonality bar when they want it. Deliberate policy, not a
  // missing-field backfill — s.musicality itself is always present.
  s.musicality.lock = false;
  return s;
}
