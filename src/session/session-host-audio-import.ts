// Audio-file import flows for SessionHost: dropping/recording a WAV into a
// dedicated audio channel, loading a WAV into a sampler/audio cell, and slicing
// an imported loop onto the current sampler lane. Extracted from session-host.ts
// (the bodies were already written in terms of `self`).

import type { SessionHost } from './session-host';
import {
  emptyLane, audioClip, audioChannelClip,
  type SessionClip,
} from './session';
import { emptyLanePlayState } from './session-runtime';
import { ensureScenesForRows } from '../core/scene-ensure';
import { nextLaneSlug } from './session-host-util';
import { withUndo } from '../save/history-wiring';
import { detectLoop } from '../samples/loop-analysis';
import { importFile, buildSampleAsset, newSampleId } from '../samples/import';
import { sliceBuffer } from '../samples/slice-buffer';
import { slicesToKeymap, audioBufferToWavBytes } from '../samples/slice-to-bank';
import { buildSliceClip } from '../core/slice-clip';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';
import { mirrorKeymapChange } from './session-engine-state';

/** Create a new dedicated 'audio' channel/lane holding the given file as a
 *  single clip (decodes + persists the sample, then adds the lane + clip as
 *  one undoable action).
 *
 *  `knownBpm`: for audio WE generated (a live take / offline render captured at
 *  the project tempo), pass the project BPM so the clip locks to the grid with
 *  warp ratio 1.0. Re-running tempo detection on our own render is unreliable
 *  (autocorrelation guesses a wrong multiple) and warps the audio — that was
 *  the "no cuadra / cortado al principio" bug. Omitted ⇒ detect (external WAVs). */
export function addAudioChannel(self: SessionHost, file: File, opts?: { knownBpm?: number }): void {
  const { ctx, seq } = self.deps;
  void ctx.resume();
  void (async () => {
    try {
      const asset = await importFile(file, ctx);
      await sampleStore.put(asset);
      const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
      sampleCache.put(asset.id, buf);
      const originalBpm = opts?.knownBpm ?? detectLoop(buf, seq.meter).originalBpm;
      const name = file.name.replace(/\.[^.]+$/, '');
      const clip = audioChannelClip({
        name, sampleId: asset.id, durationSec: buf.duration,
        originalBpm, projectMeter: seq.meter,
      });
      const hd = self.deps.historyDeps;
      const run = () => {
        const used = new Set(self.state.lanes.map((l) => l.id));
        const newId = nextLaneSlug(used, 'audio');
        const lane = emptyLane(newId, 'audio');
        lane.name = name;
        lane.clips = [clip]; // audio channel: the WAV clip lives in row 0 only
        self.state.lanes.push(lane);
        self.laneStates.set(newId, emptyLanePlayState(newId));
        self.deps.ensureLaneResource?.(newId, 'audio');
        ensureScenesForRows(self.state);
        self.inspector.setSelectedClip({ laneId: newId, clipIdx: 0 });
        self.inspector.openInspector();
        self.renderWithMixer();
        self.deps.checkpointHistory?.();
      };
      if (hd) withUndo(hd, run); else run();
    } catch (err) {
      console.warn('Audio channel: could not load loop:', err);
    }
  })();
}

/** Load a WAV into a specific cell of a sampler/audio lane. Shared by dropping
 *  a file on the cell AND — for audio channels — clicking the empty cell, which
 *  opens the file picker (the channel itself is created empty; the WAV is chosen
 *  per clip). Audio lanes get a tempo-locked audioChannelClip; sampler lanes get
 *  an audioClip. */
export function loadAudioFileIntoCell(self: SessionHost, laneId: string, clipIdx: number, file: File): void {
  const { ctx, seq } = self.deps;
  const lane = self.state.lanes.find((l) => l.id === laneId);
  if (!lane || (lane.engineId !== 'sampler' && lane.engineId !== 'audio')) return;
  void ctx.resume();
  void (async () => {
    try {
      const asset = await importFile(file, ctx);
      await sampleStore.put(asset);
      const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
      sampleCache.put(asset.id, buf);
      const name = file.name.replace(/\.[^.]+$/, '');
      const clip = lane.engineId === 'audio'
        ? audioChannelClip({
            name, sampleId: asset.id, durationSec: buf.duration,
            originalBpm: detectLoop(buf, seq.meter).originalBpm, projectMeter: seq.meter,
          })
        : audioClip({ name, sampleId: asset.id, durationSec: buf.duration, bpm: seq.bpm });
      const hd = self.deps.historyDeps;
      const run = () => {
        self.placeClipEnsuringScene(laneId, clipIdx, clip);
        self.inspector.setSelectedClip({ laneId, clipIdx });
        self.inspector.openInspector();
        self.renderWithMixer();
        self.deps.checkpointHistory?.();
      };
      if (hd) withUndo(hd, run); else run();
    } catch (err) {
      console.warn('Could not load audio into cell:', err);
    }
  })();
}

/** Front D · Task 13 — import a loop WAV into the EXISTING sampler lane.
 *  Slices the loop into per-slice bank samples (each a fresh IndexedDB id),
 *  installs that slice bank as the lane's keymap, then builds a note clip
 *  (one note per slice from SLICE_BASE_NOTE) plus a display-only waveformRef
 *  pointing at the whole loop, and drops it onto the lane via the single
 *  `installSamplerClip` seam (places + ensures the row's ▶ scene + opens the
 *  piano-roll, all under one undo entry).
 *
 *  Operates on the CURRENT sampler lane — it does NOT create a new lane (that
 *  was the removed `onSliceToBank` path). A user-imported loop is IndexedDB-
 *  only: we deliberately DON'T mirror an `instrumentId` (there's no bundled
 *  manifest to self-heal from — `reloadInstrument` would throw on reload). */
export function importLoopToSampler(self: SessionHost, laneId: string, file: File): void {
  const { ctx, seq } = self.deps;
  const lane = self.state.lanes.find((l) => l.id === laneId);
  if (!lane || lane.engineId !== 'sampler') return;
  void ctx.resume();
  void (async () => {
    try {
      // Persist + decode the whole loop first; its id backs the clip's
      // display-only waveformRef so the editor's waveform header resolves.
      const asset = await importFile(file, ctx);
      await sampleStore.put(asset);
      const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
      sampleCache.put(asset.id, buf);
      const loopId = asset.id;
      const name = file.name.replace(/\.[^.]+$/, '');

      const det = detectLoop(buf, seq.meter);
      const cuts = sliceBuffer(ctx, buf, det.slicePointsSec);
      const sliceIds: string[] = [];
      for (const cut of cuts) {
        const id = newSampleId();
        const bytes = await audioBufferToWavBytes(cut.buffer);
        await sampleStore.put(buildSampleAsset({
          id, name: `${name} ${sliceIds.length + 1}`,
          mime: 'audio/wav', bytes, buffer: cut.buffer, createdAt: Date.now(),
        }));
        sampleCache.put(id, cut.buffer);
        sliceIds.push(id);
      }
      const km = slicesToKeymap(sliceIds);
      const built = buildSliceClip({
        slicePointsSec: det.slicePointsSec, durationSec: buf.duration,
        originalBpm: det.originalBpm, projectMeter: seq.meter,
        gridResolution: DEFAULT_RESOLUTION,
      });
      // Install the bank on the lane's live engine + mirror it (the lane is
      // not recreated — this replaces the current sampler keymap).
      const eng = self.deps.laneResources?.get(laneId)?.engine as unknown as
        { setKeymap?(k: typeof km): void } | undefined;
      eng?.setKeymap?.(km);
      mirrorKeymapChange(self.state, laneId, km);

      const noteClip: SessionClip = {
        id: `clip-${Date.now().toString(36)}`,
        name: `${name} loop`,
        lengthBars: built.lengthBars,
        notes: built.notes,
        gridResolution: DEFAULT_RESOLUTION,
        // Display-only: waveform + slice markers above the notes in the editor.
        waveformRef: { sampleId: loopId, slices: built.slices },
      };
      // Single placement seam (front A): places the clip, guarantees the row's
      // ▶ scene, opens the piano-roll, all bracketed in one undo entry.
      self.installSamplerClip(laneId, noteClip);
      // Conform the project tempo to the loop (see the loom:loop-loaded handler)
      // so an imported loop sounds natural immediately, no manual BPM change.
      if (det.originalBpm > 0) self.deps.applyBpm?.(det.originalBpm);
    } catch (err) {
      console.warn('Sampler loop import: could not load loop:', err);
    }
  })();
}
