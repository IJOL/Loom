// src/core/scene-ensure.ts
// Append scenes so every clip row across all lanes has a launchable scene
// (and therefore a play button in the grid). The grid renders a scene-launch
// button only for rows that have a state.scenes[r], so adding a lane / dropping
// a loop without this leaves the row un-launchable. Mutates state in place.

import type { SessionState } from '../session/session';

export function ensureScenesForRows(state: SessionState): boolean {
  let maxClipRows = 0;
  for (const lane of state.lanes) maxClipRows = Math.max(maxClipRows, lane.clips.length);
  // Minimum seed: with at least one lane, guarantee at least one launchable scene.
  // (Front A stops auto-filling empty clips, so every lane can be `clips:[]` →
  // maxClipRows 0 → no scenes → the grid would show no scene-launch button at all.)
  if (state.lanes.length > 0) maxClipRows = Math.max(maxClipRows, 1);
  let added = false;
  while (state.scenes.length < maxClipRows) {
    state.scenes.push({
      id: `scene-${Date.now().toString(36)}-${state.scenes.length}`,
      name: `Scene ${state.scenes.length + 1}`,
      clipPerLane: {},
    });
    added = true;
  }
  return added;
}
