// src/core/lane-display.ts
// Single source of truth for user-facing lane labels — derives a slug from
// the session lane's display name and uses it everywhere a laneId is shown
// to the user (automation paramId display, modulator destination dropdown,
// mixer column header). Internal canonical IDs (registry keys, connection
// paramIds, etc.) stay as `bass` / `main` / `drums` / `poly1` for backwards
// compatibility with saved state; only the DISPLAY uses the slug.

/** Normalise a free-form display name into a safe slug:
 *    "TB-303 1"     → "tb-303-1"
 *    "Subtractive 1"→ "subtractive-1"
 *    "Drums 1"      → "drums-1" */
export function slugifyLaneName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Map a legacy track id (used by mixer + step-grid) to its matching session
 *  lane id (used in paramId registry keys). Most ids are the same; the two
 *  exceptions are `poly` ↔ `main` and `drumBus` ↔ `drums`. */
export function trackIdToLaneId(trackId: string): string {
  if (trackId === 'poly')    return 'main';
  if (trackId === 'drumBus') return 'drums';
  return trackId;
}

/** Inverse of trackIdToLaneId — used by code paths that have a laneId and
 *  need the matching mixer-track id. */
export function laneIdToTrackId(laneId: string): string {
  if (laneId === 'main')  return 'poly';
  if (laneId === 'drums') return 'drumBus';
  return laneId;
}

/** Resolve a laneId or trackId to a display slug (e.g. `subtractive-1`)
 *  via the supplied session-lane lookup. Falls back to the laneId itself
 *  when no display name is found, so callers always get a stable string. */
export function laneDisplaySlug(
  laneOrTrackId: string,
  lookupSessionLaneName: (laneId: string) => string | undefined,
): string {
  const laneId = trackIdToLaneId(laneOrTrackId);
  const name = lookupSessionLaneName(laneId);
  if (!name) return laneId;
  return slugifyLaneName(name);
}

/** Rewrite a paramId (`<laneId>.<spec.id>`) so its prefix is replaced by the
 *  user-facing slug. Used by automation/modulation UIs that surface raw
 *  paramIds to the user. */
export function formatParamIdForDisplay(
  paramId: string,
  lookupSessionLaneName: (laneId: string) => string | undefined,
): string {
  const dot = paramId.indexOf('.');
  if (dot < 0) return paramId;
  const prefix = paramId.slice(0, dot);
  const rest   = paramId.slice(dot + 1);
  const slug   = laneDisplaySlug(prefix, lookupSessionLaneName);
  return slug === prefix ? paramId : `${slug}.${rest}`;
}
