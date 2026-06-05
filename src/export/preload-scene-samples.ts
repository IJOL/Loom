// src/export/preload-scene-samples.ts
// Ensure every sample buffer referenced by the given lanes is decoded into the
// shared sampleCache before an offline render. Drumkit lanes decode via
// applyLaneEngineState's awaited reloadDrumkit; this covers keymap one-shots and
// clip (loop/song) samples. Missing ids are skipped silently — the voice simply
// stays quiet.

import type { SessionLane } from '../session/session';
import { sampleCache } from '../samples/sample-cache';
import { sampleStore } from '../samples/store-singleton';

/** All distinct sampleIds referenced by the given lanes' keymaps + clip samples. */
export function collectSampleIds(lanes: SessionLane[]): Set<string> {
  const ids = new Set<string>();
  for (const lane of lanes) {
    for (const entry of lane.engineState?.sampler?.keymap ?? []) {
      if (entry.sampleId) ids.add(entry.sampleId);
    }
    for (const clip of lane.clips) {
      if (clip?.sample?.sampleId) ids.add(clip.sample.sampleId);
    }
  }
  return ids;
}

/** Decode all referenced sample buffers into sampleCache (no-op for ids already
 *  cached). */
export async function preloadSceneSamples(ctx: AudioContext, lanes: SessionLane[]): Promise<void> {
  const ids = collectSampleIds(lanes);
  await Promise.all([...ids].map((id) => sampleCache.ensureLoaded(ctx, id, sampleStore)));
}
