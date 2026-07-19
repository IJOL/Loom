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
import { reloadDrumkit, reloadInstrument, reloadPreset } from './session-host-presets';
import { pruneKnobRegistry } from '../app/knob-registry-prune';

/** Snapshot the two send buses (return level, mute, and preserved insert slots).
 *  Insert slots are session-owned (like lane/master inserts) — `prev` carries
 *  whatever was already persisted so we don't drop them on a live-knob save. */
export function collectSends(fx: FxBus, prev: SendBusState[] | undefined): SendBusState[] {
  return fx.sends.map((bus) => ({
    id: bus.id,
    label: bus.label,
    returnLevel: bus.getReturnLevel(),
    muted: bus.isMuted(),
    inserts: prev?.find((p) => p.id === bus.id)?.inserts ?? [],
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
    while (bus.inserts.size() > 0) bus.inserts.remove(0);
    rehydrateInsertChain(ctx, bus.inserts, state.inserts);
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
  // Drop knob handles belonging to lanes this session doesn't have. The map is
  // keyed `<laneId>.<param>` and only ever grew, so without this every load
  // piled the previous session's instruments onto every param picker.
  pruneKnobRegistry(self.deps.automationRegistry, keep);
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
  // Close any editor left open on a lane/clip that the new state no longer has
  // (e.g. "New" wipes every lane but the synth-lane editor + clip inspector
  // stayed mounted showing the old lane). Must run BEFORE renderWithMixer so the
  // grid is repainted without a stale open-clip ring.
  reconcileOpenEditors(self);
  self.renderWithMixer();
  // Decode every referenced audio buffer (audio clips, sampler keymaps, slice
  // banks) into the cache so loaded sessions sound on first Play, not just on
  // offline export. Fire-and-forget: editors render regardless; audio comes
  // alive once decode resolves.
  void preloadSceneSamples(self.deps.ctx, self.state.lanes);
  self._fireStateApplied();
  // The load just rewrote the whole lane/insert set (rehydrateInsertChain
  // above mutates chains directly, bypassing buildLaneInsertUI's own
  // onDestinationsChanged) — announce once rather than relying on each
  // per-lane ensureLaneResource/swapLaneEngine call along the way.
  self.deps.onDestinationsChanged?.();
}

/** After a state swap (New / load / demo / stem-Replace), close any editor that
 *  now points at a lane or clip the new state no longer contains. Without this
 *  the synth-lane editor page stayed visible showing the old lane, and the clip
 *  inspector stayed open on a deleted clip. */
export function reconcileOpenEditors(self: SessionHost): void {
  // Synth-lane editor: the edited lane is gone ⇒ hide its editor pages + clear
  // the active-lane focus (mirrors what the UI shows when no lane is selected).
  if (self.activeEditLane && !self.state.lanes.some((l) => l.id === self.activeEditLane)) {
    self.activeEditLane = null;
    document.querySelectorAll<HTMLElement>('#session-view-root .page')
      .forEach((p) => { p.hidden = true; });
    self.deps.onActiveLaneChanged?.();
  }
  // Clip inspector: the selected clip's lane or clip is gone ⇒ close it.
  const sel = self.inspector?.getSelectedClip?.();
  if (sel) {
    const lane = self.state.lanes.find((l) => l.id === sel.laneId);
    if (!lane || !lane.clips[sel.clipIdx]) self.inspector.closeInspector();
  }
}

/** Mirror live modulator + note-FX state back onto each lane before a save.
 *  Params are mirrored live on every knob change, so only modulators + noteFx
 *  are refreshed here (replacing the whole engineState object dropped per-lane
 *  knob values on save). Also refreshes send-bus return level + mute. */
/** The modulators to seed a duplicated lane's engine with. The live host is the
 *  source of truth (a lane plays what its ModulationHost holds); the persisted
 *  `engineState.modulators` is only a fallback for a lane whose engine was never
 *  allocated. Deep-copied so the clone never shares the source's array. */
export function modulatorsForDuplicatedLane(
  liveHost: { serialize(): unknown[] } | undefined,
  engineState: { modulators?: import('../modulation/types').ModulatorState[] } | undefined,
): import('../modulation/types').ModulatorState[] {
  const src = liveHost ? liveHost.serialize() : engineState?.modulators;
  return src ? (JSON.parse(JSON.stringify(src)) as import('../modulation/types').ModulatorState[]) : [];
}

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
    // Snapshot the live mixer strip (level/pan/EQ/sends/mute/comp/sidechain).
    // Without this a save dropped the whole per-lane mixer ("Save doesn't save
    // the full mixer state").
    const strip = self.deps.laneResources?.get(lane.id)?.strip;
    if (strip) lane.mixer = strip.serialize();
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
  const res = self.deps.laneResources?.get(lane.id);
  // Restore the per-lane mixer strip (level/pan/EQ/sends/mute/comp/sidechain).
  // Older saves have no `mixer` — the strip then keeps its constructed defaults.
  if (res?.strip && lane.mixer) res.strip.restore(lane.mixer);
  const engine = res?.engine;
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
    // Normal Sampler preset (presets/sampler.json) self-heal: fire-and-forget,
    // re-fetches the preset's zone URLs (mirror of reloadInstrument).
    reloadPreset: (laneId, name, eng) => { void reloadPreset(self, laneId, name, eng); },
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
  // No second onDestinationsChanged here: listAutomationTargets derives
  // destinations from session data (lane.inserts, a plain JSON field), never
  // from the live audio graph, and duplicateLane (session-ops.ts) deep-clones
  // the whole lane — including inserts — and splices it into state.lanes
  // BEFORE this function runs. ensureLaneResource's own invalidate above
  // already sees the fully-populated clone.
}
