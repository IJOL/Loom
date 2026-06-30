// src/app/import-lane-prep.ts
//
// Allocate audio resources for freshly-imported lanes and apply each lane's
// preset ONCE (when first allocated). Imported lanes bypass the host's normal
// applyLoadedSessionState path, so this mirrors its per-lane prep.
//
// CRITICAL: a synth/melodic lane applies its preset through `applyPresetForLane`
// — the SAME path the live host uses — which not only sets the engine params but
// ALSO records the preset-dropdown selection (recordPagePresetForLane +
// refreshPolyPresetSelect). The previous code applied the preset to the engine
// directly (applyPresetToEngine), so the sound was right but every imported synth
// lane's dropdown showed "(custom — no preset)".

import type { SessionLane } from '../session/session';

export interface ImportLanePrepDeps {
  /** True if the lane already has an allocated audio resource. */
  hasResource: (laneId: string) => boolean;
  /** Allocate (idempotently) the lane's audio resource for its engine. */
  ensureLaneResource: (laneId: string, engineId: string) => void;
  /** The live engine instance for a lane (post-ensure), or null. */
  getEngineInstance: (laneId: string) => unknown | null;
  /** Load a sample-kit Drums preset (kitMode 'sample' + async decode). */
  applyDrumPreset: (laneId: string, name: string) => void;
  /** Reload a Sampler drumkit (fetch + decode + push to worklet). */
  reloadDrumkit: (laneId: string, kitId: string, inst: unknown) => void;
  /** Apply a prefix-tagged preset to a lane THROUGH the host path that also
   *  records the preset-dropdown selection. */
  applyPresetForLane: (laneId: string, presetName: string) => void;
}

export function prepImportedLanes(lanes: SessionLane[], deps: ImportLanePrepDeps): void {
  for (const lane of lanes) {
    const isNew = !deps.hasResource(lane.id);
    deps.ensureLaneResource(lane.id, lane.engineId);
    // Launching a scene never re-applies a preset to an already-allocated lane —
    // the sound is a per-channel property.
    if (!isNew) continue;

    const kitId = lane.engineState?.sampler?.drumkitId;
    if (kitId && lane.engineId === 'drums-machine') {
      // Imported percussion lane (sample-kit Drums): applyDrumPreset sets kitMode
      // 'sample' + async fetch/decode/setKeymap so the kit actually plays.
      const name = (lane.enginePresetName ?? '').replace(/^engine:/, '') || 'GM Percussion';
      deps.applyDrumPreset(lane.id, name);
    } else if (kitId) {
      // Sampler drumkit lane: reloadDrumkit fetches+decodes + pushes to the worklet.
      const inst = deps.getEngineInstance(lane.id);
      if (inst && typeof inst === 'object' && 'setKeymap' in inst) {
        deps.reloadDrumkit(lane.id, kitId, inst);
      }
    } else if (lane.enginePresetName) {
      // Synth/melodic (or melodic Sampler) lane: route through the host path so
      // the preset dropdown reflects the imported preset (was the bypass bug).
      deps.applyPresetForLane(lane.id, lane.enginePresetName);
    }
  }
}
