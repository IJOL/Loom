// src/core/lane-ids.ts
// Canonical lane identifiers. Each lane gets a slug id derived from its
// initial display name, fixed at creation time (Camino A — renaming the
// lane's `name` does not change its `id` so saved connections survive).
//
// The four built-in lanes have these stable ids. Extra lanes (added via the
// "+" tab) derive their id from `slugifyLaneName(initialName)` with a
// uniqueness suffix when collisions occur.

export const LANE_ID_BASS  = 'tb-303-1';
export const LANE_ID_DRUMS = 'drums-1';
export const LANE_ID_POLY  = 'subtractive-1';
export const LANE_ID_POLY2 = 'subtractive-2';

/** Built-in lane ids that the audio graph treats specially (singleton
 *  engines, dedicated mixer strips, etc.). Other lanes are "extras". */
export const BUILTIN_LANE_IDS = [LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY] as const;

export type BuiltinLaneId = typeof BUILTIN_LANE_IDS[number];

export function isBuiltinLaneId(id: string): id is BuiltinLaneId {
  return (BUILTIN_LANE_IDS as readonly string[]).includes(id);
}
