// Drum-preset application + bundled-instrument self-heal for SessionHost.
// These are ctx-aware (async fetch/decode) so they live on the host rather than
// in the pure engine-state layer. Extracted from session-host.ts.

import type { SessionHost } from './session-host';
import type { KeymapEntry } from '../samples/types';
import { mirrorKeymapChange, mirrorDrumkitId, mirrorPadParams } from './session-engine-state';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { fetchInstrumentManifest, loadInstrument } from '../samples/instrument-loader';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { findDrumKit } from '../presets/drum-kits-loader';

/** Re-load a bundled drumkit by id into a sampler lane (fresh sampleIds +
 *  decoded cache), then re-mirror the resolved keymap. Fire-and-forget from
 *  applyEngineState; the drum-grid editor renders its 8 rows regardless and
 *  audio comes alive once the fetch/decode completes. */
export async function reloadDrumkit(
  self: SessionHost,
  laneId: string,
  kitId: string,
  engine: { setKeymap(k: KeymapEntry[]): void },
): Promise<void> {
  try {
    const manifest = await fetchDrumkitManifest(kitId);
    const km = await loadDrumkit(manifest, self.deps.ctx);
    engine.setKeymap(km);
    mirrorKeymapChange(self.state, laneId, km);
  } catch (err) {
    console.warn(`[drumkit] failed to reload '${kitId}' for ${laneId}:`, err);
  }
}

/** Re-load a bundled melodic/loop instrument by id into a sampler lane (mirror
 *  of reloadDrumkit). Self-healing: fresh sampleIds + decoded cache every call,
 *  then re-mirror the resolved keymap.
 *
 *  - Melodic: fetch the manifest, decode every zone, push the multi-zone keymap
 *    + any per-zone padParams the manifest carried.
 *  - Loop: regenerate the slice bank AND re-persist the whole-loop wav with a
 *    fresh id, re-pointing the loop clip's `waveformRef.sampleId` for this lane
 *    so the editor's waveform header survives a reload (corrects D8). The note
 *    clip + scene are NOT rebuilt here — they already live in SessionState.
 *
 *  Fire-and-forget from applyEngineState; the editor renders regardless and
 *  audio comes alive once the fetch/decode completes. */
export async function reloadInstrument(
  self: SessionHost,
  laneId: string,
  instrumentId: string,
  engine: { setKeymap(k: KeymapEntry[]): void },
): Promise<void> {
  try {
    const manifest = await fetchInstrumentManifest(instrumentId);
    if (manifest.family === 'loop') {
      const loaded = await loadInstrument(manifest, self.deps.ctx);
      engine.setKeymap(loaded.keymap);
      mirrorKeymapChange(self.state, laneId, loaded.keymap);
      // Re-persist the whole-loop wav with a fresh id and re-point every loop
      // clip's waveformRef on this lane so the editor's waveform header keeps
      // resolving after a session/demo reload (the slices got fresh ids above;
      // the whole-loop buffer must too).
      const res = await fetch(`${import.meta.env.BASE_URL}instruments/${manifest.file}`);
      const bytes = await res.arrayBuffer();
      const buffer = await self.deps.ctx.decodeAudioData(bytes.slice(0));
      const loopId = newSampleId();
      await sampleStore.put(buildSampleAsset({
        id: loopId, name: `${manifest.id}/loop.wav`, mime: 'audio/wav',
        bytes, buffer, createdAt: Date.now(),
      }));
      sampleCache.put(loopId, buffer);
      const lane = self.state.lanes.find((l) => l.id === laneId);
      for (const clip of lane?.clips ?? []) {
        if (clip?.waveformRef) clip.waveformRef = { ...clip.waveformRef, sampleId: loopId };
      }
    } else {
      const loaded = await loadInstrument(manifest, self.deps.ctx);
      engine.setKeymap(loaded.keymap);
      mirrorKeymapChange(self.state, laneId, loaded.keymap);
      if (loaded.padParams) {
        const pad = loaded.padParams as Record<number, Record<string, number>>;
        (engine as unknown as { setPadStore?(s: Record<number, Record<string, number>>): void }).setPadStore?.(pad);
        mirrorPadParams(self.state, laneId, pad);
      }
    }
  } catch (err) {
    console.warn(`[instrument] failed to reload '${instrumentId}' for ${laneId}:`, err);
  }
}

/** Live drums-page preset pick (ctx-aware). Synth kits go through the engine's
 *  sync applyPreset; sample kits decode the bundled drumkit into the embedded
 *  sampler here (we hold the AudioContext), mirror the sub-state, then rebuild
 *  the inspector engine-body so the panel swaps. */
export async function applyDrumPreset(self: SessionHost, laneId: string, name: string): Promise<void> {
  const entry = findDrumKit(name);
  const engine = self.deps.laneResources?.get(laneId)?.engine as unknown as {
    applyPreset(n: string): void;
    setKitMode(m: 'synth' | 'sample'): void;
    setKeymap(k: KeymapEntry[]): void;
  } | undefined;
  if (!entry || !engine) return;

  engine.applyPreset(name);        // sets kitMode (+ synth loadKitDefaults)
  if (entry.kind === 'sample' && entry.drumkitId) {
    engine.setKitMode('sample');   // belt-and-suspenders before the async decode
    try {
      const manifest = await fetchDrumkitManifest(entry.drumkitId);
      const km = await loadDrumkit(manifest, self.deps.ctx);
      engine.setKeymap(km);
      mirrorKeymapChange(self.state, laneId, km);
      mirrorDrumkitId(self.state, laneId, entry.drumkitId);
    } catch (err) {
      console.warn(`[drumkit] failed to load '${entry.drumkitId}' for ${laneId}:`, err);
    }
  } else {
    // Synth kit: drop any stale drumkit sub-state so a later load doesn't
    // re-trigger the sample self-heal.
    mirrorDrumkitId(self.state, laneId, undefined);
  }

  const lane = self.state.lanes.find((l) => l.id === laneId);
  if (lane) {
    if (!lane.engineState) lane.engineState = {};
    const prevMode = lane.engineState.kitMode;
    if (prevMode && prevMode !== entry.kind && lane.engineState.params) {
      // Per-voice ids (e.g. 'kick.tune') mean different things + ranges in
      // synth vs sample mode; bus.* is mode-agnostic. Drop the per-voice keys
      // so a kit-mode switch doesn't replay stale cross-mode values into the
      // other source on the next load.
      for (const id of Object.keys(lane.engineState.params)) {
        if (!id.startsWith('bus.')) delete lane.engineState.params[id];
      }
    }
    lane.engineState.kitMode = entry.kind;
    lane.enginePresetName = `engine:${name}`;
  }

  // Rebuild the inspector engine-body so the synth rack <-> sampler panel swaps
  // immediately (this also re-pushes current knob values). Only when this lane
  // is the one being edited.
  if (self.activeEditLane === laneId) self.injectEngineModulatorPanel(laneId, 'drums');
}
