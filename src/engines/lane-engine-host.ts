import { createEngineInstance } from './registry';
import type { SynthEngine } from './engine-types';
import type { Sequencer } from '../core/sequencer';
import type { PatternBank } from '../core/pattern';

// ── Per-lane engine management ────────────────────────────────────────────
// One independent SynthEngine instance per lane (main + each extra) whenever
// the lane's engineId is non-subtractive. Subtractive lanes keep using their
// existing PolySynth (polysynth or extraPolys[id]); no map entry needed.

export interface LaneEngineHostState {
  instances: Map<string, SynthEngine>;
  activeLaneId: string;
  slotConfigurators: Array<(() => void) | null>;
}

export interface LaneEngineHostDeps {
  seq: Sequencer;
  bank: PatternBank;
  engineSel: HTMLSelectElement;
  /** Called after the engine param panel needs to be re-built. */
  rebuildEngineParamUI: () => void;
  /** Lane labels map (laneId → display string). */
  laneLabels: Record<string, string>;
  /** Mirror legacy currentEngineId when main lane changes. */
  setCurrentEngineId: (id: string) => void;
}

export function createLaneEngineState(): LaneEngineHostState {
  return {
    instances: new Map<string, SynthEngine>(),
    activeLaneId: 'main',
    slotConfigurators: [null, null, null, null],
  };
}

/** Returns the engineId stored in the pattern for a given lane, defaulting to 'subtractive'. */
export function getLaneEngineId(
  state: LaneEngineHostState,
  deps: LaneEngineHostDeps,
  laneId: string,
): string {
  if (laneId === 'subtractive-1') return deps.seq.pattern.engineId ?? 'subtractive';
  const track = deps.seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
  return track?.engineId ?? 'subtractive';
}

/** Writes the engineId back into the pattern for a given lane. */
export function setLaneEngineIdInPattern(
  deps: LaneEngineHostDeps,
  laneId: string,
  id: string,
): void {
  if (laneId === 'subtractive-1') {
    deps.seq.pattern.engineId = id;
  } else {
    const track = deps.seq.pattern.extraPolyTracks.find((t) => t.id === laneId);
    if (track) track.engineId = id;
  }
}

/**
 * Reconcile the live instance map with the requested engineId for a lane.
 * Disposes/recreates as needed. Returns the instance or null (subtractive).
 */
export function ensureLaneEngine(
  state: LaneEngineHostState,
  laneId: string,
  engineId: string,
): SynthEngine | null {
  const existing = state.instances.get(laneId);
  if (engineId === 'subtractive') {
    if (existing) { existing.dispose(); state.instances.delete(laneId); }
    return null;
  }
  if (existing && existing.id === engineId) return existing;
  if (existing) existing.dispose();
  const inst = createEngineInstance(engineId);
  if (!inst) return null;
  state.instances.set(laneId, inst);
  return inst;
}

/** Returns the live SynthEngine instance for a lane, or null for subtractive. */
export function getLaneEngineInstance(
  state: LaneEngineHostState,
  laneId: string,
): SynthEngine | null {
  return state.instances.get(laneId) ?? null;
}

/**
 * Switch what the engine selector + engine-controls panel are editing.
 * Updates activeLaneId, syncs the <select> value, and triggers a UI rebuild.
 */
export function setActiveEngineLane(
  state: LaneEngineHostState,
  deps: LaneEngineHostDeps,
  laneId: string,
): void {
  state.activeLaneId = laneId;
  const id = getLaneEngineId(state, deps, laneId);
  deps.engineSel.value = id;
  if (laneId === 'subtractive-1') deps.setCurrentEngineId(id);
  ensureLaneEngine(state, laneId, id);
  const laneLabel = document.getElementById('engine-lane-label');
  if (laneLabel) {
    laneLabel.textContent = deps.laneLabels[laneId] ?? laneId;
  }
  deps.rebuildEngineParamUI();
}

/**
 * Recreate engine instances for every lane to match the current pattern's
 * engineIds. Called after any slot/pattern swap.
 */
export function syncEngineToPattern(
  state: LaneEngineHostState,
  deps: LaneEngineHostDeps,
): void {
  ensureLaneEngine(state, 'main', getLaneEngineId(state, deps, 'main'));
  for (const track of deps.seq.pattern.extraPolyTracks) {
    ensureLaneEngine(state, track.id, track.engineId ?? 'subtractive');
  }
  // Apply per-slot engine configuration (if registered by demo, etc.)
  const cb = state.slotConfigurators[deps.bank.current];
  if (cb) cb();
  // Refresh the active-lane UI bindings (engine selector + params panel)
  const id = getLaneEngineId(state, deps, state.activeLaneId);
  deps.engineSel.value = id;
  if (state.activeLaneId === 'main') deps.setCurrentEngineId(id);
  deps.rebuildEngineParamUI();
}

/** Replace all slot configurator callbacks (called from demo wiring). */
export function setSlotConfigurators(
  state: LaneEngineHostState,
  cbs: Array<(() => void) | null>,
): void {
  state.slotConfigurators = cbs;
}
