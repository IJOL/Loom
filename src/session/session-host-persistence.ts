// Session load/save state plumbing for SessionHost: applying a loaded
// SessionState (lane allocation + insert/engine rehydration), collecting live
// engine state before save, and pushing persisted engine state onto live
// engines. Extracted from session-host.ts.

import type { SessionHost } from './session-host';
import type { SessionState, SessionLane } from './session';
import type { FxBus } from '../core/fx';
import type { SendBusState } from '../core/send-bus';
import { migrateLoadedSessionState } from './session-migration';
import { emptyLanePlayState } from './session-runtime';
import { rehydrateInsertChain } from './insert-slot';
import { preloadSceneSamples } from '../export/preload-scene-samples';
import { applyLaneEngineState } from '../export/apply-lane-engine-state';
import { getNoteFxChain, loadNoteFxForLane } from '../notefx/notefx-registry';
import { reloadDrumkit, reloadInstrument } from './session-host-presets';

/** Snapshot the two send buses (return level, mute, and preserved insert slots).
 *  Insert slots are session-owned (like lane/master inserts) — `prev` carries
 *  whatever was already persisted so we don't drop them on a live-knob save. */
export function collectSends(fx: FxBus, prev: SendBusState[] | undefined): SendBusState[] {
  return fx.sends.map((bus, i) => ({
    id: bus.id,
    label: bus.label,
    returnLevel: bus.getReturnLevel(),
    muted: bus.isMuted(),
    inserts: prev?.[i]?.inserts ?? [],
  }));
}

/** Apply persisted send-bus state: return level, mute, and rehydrated inserts. */
export function rehydrateSends(ctx: AudioContext, fx: FxBus, sends: SendBusState[] | undefined): void {
  if (!sends) return;
  for (const state of sends) {
    const bus = fx.sends.find((b) => b.id === state.id);
    if (!bus) continue;
    bus.label = state.label;
    bus.setReturnLevel(state.returnLevel);
    bus.setMuted(state.muted);
    if (state.inserts && state.inserts.length > 0) {
      while (bus.inserts.size() > 0) bus.inserts.remove(0);
      rehydrateInsertChain(ctx, bus.inserts, state.inserts);
    }
  }
}

/** Replace the host's session with a loaded/migrated SessionState: reconcile
 *  lane audio resources (allocate / swap / dispose), rehydrate insert chains
 *  (lane + master), apply per-lane engine state, then render + preload samples. */
export function applyLoadedSessionState(self: SessionHost, sess: SessionState): void {
  // Silence any still-sounding live voices BEFORE we clear laneStates and
  // dispose lanes. A playing 'audio'/stem clip schedules a whole-loop buffer
  // source that nobody else stops, so without this a Load or a demo-switch
  // would leave the previous clip ringing. This single choke point covers both
  // (every SaveManager load and the demo picker reach here); the New button's
  // explicit pre-stop becomes redundant-but-harmless.
  self.deps.liveVoices?.silenceAll(self.deps.ctx.currentTime);
  const migrated = migrateLoadedSessionState(sess);
  self.state.lanes = migrated.lanes ?? [];
  self.state.scenes = migrated.scenes ?? [];
  self.state.globalQuantize = migrated.globalQuantize ?? '1/1';
  self.state.masterInserts = migrated.masterInserts ?? [];
  self.state.sends = migrated.sends;
  self.laneStates.clear();
  // Free audio resources for lanes that vanished in the new state (e.g.
  // undo of add-lane). Keeping orphans around accumulates ChannelStrips and
  // engine instances each time the user cycles add → undo → add.
  const keep = new Set(self.state.lanes.map((l) => l.id));
  for (const id of self.deps.laneResources?.ids() ?? []) {
    if (!keep.has(id)) self.deps.laneResources?.dispose(id);
  }
  for (const lane of self.state.lanes) {
    self.laneStates.set(lane.id, emptyLanePlayState(lane.id));
    // Every lane needs an audio resource (strip + engine instance) — without
    // it, triggerForLane finds nothing and automation knobs never get
    // registered under the lane's id. Built-in lanes are pre-allocated at
    // boot; lanes that arrive via loaded state (demos, save files) are
    // allocated lazily here.
    // Allocate lazily, OR reconcile a lane whose engineId changed (undo/redo
    // or a loaded session): if a resource exists but its live engine differs
    // from the lane's engineId, swap it in place rather than skip (the
    // idempotent ensureLaneResource would otherwise leave the old engine).
    const existing = self.deps.laneResources?.get(lane.id);
    if (existing && existing.engine.id !== lane.engineId) {
      self.deps.swapLaneEngine?.(lane.id, lane.engineId);
    } else {
      self.deps.ensureLaneResource?.(lane.id, lane.engineId);
    }
    // Task 28: rehydrate persisted insert slots into the lane's chain.
    if (lane.inserts && lane.inserts.length > 0) {
      const laneRes = self.deps.laneResources?.get(lane.id);
      if (laneRes?.inserts) {
        rehydrateInsertChain(self.deps.ctx, laneRes.inserts, lane.inserts);
      }
    }
    if (lane.enginePresetName) {
      self.deps.applyPresetForLane?.(lane.id, lane.enginePresetName);
    }
  }
  applyEngineState(self);
  // Task 28: rehydrate master insert chain before firing state-applied callbacks
  // so the UI rebuild (rebuildMasterInserts) sees a populated chain.
  const masterChain = self.deps.masterInsertChain;
  if (masterChain && self.state.masterInserts && self.state.masterInserts.length > 0) {
    while (masterChain.size() > 0) masterChain.remove(0);
    rehydrateInsertChain(self.deps.ctx, masterChain, self.state.masterInserts);
  }
  // FX send buses: return level, mute, and insert chains.
  if (self.deps.fxBus) rehydrateSends(self.deps.ctx, self.deps.fxBus, self.state.sends);
  self.renderWithMixer();
  // Decode every referenced audio buffer (audio clips, sampler keymaps, slice
  // banks) into the cache so loaded sessions sound on first Play, not just on
  // offline export. Fire-and-forget: editors render regardless; audio comes
  // alive once decode resolves.
  void preloadSceneSamples(self.deps.ctx, self.state.lanes);
  self._fireStateApplied();
}

/** Mirror live modulator + note-FX state back onto each lane before a save.
 *  Params are mirrored live on every knob change, so only modulators + noteFx
 *  are refreshed here (replacing the whole engineState object dropped per-lane
 *  knob values on save). Also refreshes send-bus return level + mute. */
export function collectEngineState(self: SessionHost): void {
  for (const lane of self.state.lanes) {
    const engine = self.deps.laneResources?.get(lane.id)?.engine;
    const host = (engine as { modulators?: { serialize(): unknown[] } } | undefined)?.modulators;
    if (host) {
      if (!lane.engineState) lane.engineState = {};
      lane.engineState.modulators =
        host.serialize() as import('../modulation/types').ModulatorState[];
    }
    // Mirror the lane's note-FX chain so it persists on save.
    if (!lane.engineState) lane.engineState = {};
    lane.engineState.noteFx = getNoteFxChain(lane.id).serialize();
  }
  // Refresh send-bus return level + mute (inserts are session-owned, preserved via prev).
  if (self.deps.fxBus) {
    self.state.sends = collectSends(self.deps.fxBus, self.state.sends);
  }
}

/** Push persisted engine state (params, modulators, note-FX, drumkit/instrument
 *  keymaps) onto every lane's live engine, self-healing bundled samples. */
export function applyEngineState(self: SessionHost): void {
  for (const lane of self.state.lanes) applyEngineStateForLane(self, lane);
}

/** Apply ONE lane's persisted engineState to its live engine. Extracted so the
 *  duplicate-lane path can rehydrate a single new lane without touching others. */
export function applyEngineStateForLane(self: SessionHost, lane: SessionLane): void {
  const engine = self.deps.laneResources?.get(lane.id)?.engine;
  if (!engine) return;
  void applyLaneEngineState(engine as never, lane, self.deps.ctx, {
    loadNoteFx: (laneId, state) => loadNoteFxForLane(laneId, state),
    // Live: fire-and-forget the drumkit reload (the editor renders regardless;
    // audio comes alive once the fetch/decode resolves).
    reloadDrumkit: (laneId, kitId, eng) => { void reloadDrumkit(self, laneId, kitId, eng); },
    // Bundled melodic/loop instrument self-heal: fire-and-forget like the
    // drumkit reload. The persisted keymap is already applied above, so the
    // live editor renders; audio comes alive once the fetch/decode resolves.
    reloadInstrument: (laneId, id, eng) => { void reloadInstrument(self, laneId, id, eng); },
  });
}

/** Allocate + configure the audio resource for a single (newly added) lane:
 *  fresh ChannelStrip + engine instance, persisted inserts, preset, and engine
 *  state. Mirrors the per-lane work `applyLoadedSessionState` does, for the
 *  duplicate-lane path which adds one lane without reloading the session. */
export function rehydrateLane(self: SessionHost, lane: SessionLane): void {
  self.deps.ensureLaneResource?.(lane.id, lane.engineId);
  if (lane.inserts && lane.inserts.length > 0) {
    const laneRes = self.deps.laneResources?.get(lane.id);
    if (laneRes?.inserts) rehydrateInsertChain(self.deps.ctx, laneRes.inserts, lane.inserts);
  }
  if (lane.enginePresetName) self.deps.applyPresetForLane?.(lane.id, lane.enginePresetName);
  applyEngineStateForLane(self, lane);
}
