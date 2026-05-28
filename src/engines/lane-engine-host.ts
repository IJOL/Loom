import type { Sequencer } from '../core/sequencer';
import type { PatternBank } from '../core/pattern';

// ── Per-lane engine management ────────────────────────────────────────────
// After Phase B every lane already has a SynthEngine in `laneResources`.
// This module now only tracks active-lane UI state; engine lifecycle is
// handled by laneResources (see src/core/lane-resources.ts).

export interface LaneEngineHostState {
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
  /** Reads the engineId from the SessionState single source of truth.
   *  Falls back to 'subtractive' for unknown lanes. */
  lookupEngineId: (laneId: string) => string;
}

export function createLaneEngineState(): LaneEngineHostState {
  return {
    activeLaneId: 'subtractive-1', // matches the default-active session lane
    slotConfigurators: [null, null, null, null],
  };
}

/** Returns the engineId for a given lane via the SessionState source of truth. */
export function getLaneEngineId(
  state: LaneEngineHostState,
  deps: LaneEngineHostDeps,
  laneId: string,
): string {
  return deps.lookupEngineId(laneId);
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
  const laneLabel = document.getElementById('engine-lane-label');
  if (laneLabel) {
    laneLabel.textContent = deps.laneLabels[laneId] ?? laneId;
  }
  deps.rebuildEngineParamUI();
}

/** Replace all slot configurator callbacks (called from demo wiring). */
export function setSlotConfigurators(
  state: LaneEngineHostState,
  cbs: Array<(() => void) | null>,
): void {
  state.slotConfigurators = cbs;
}

/** Invoke the configurator registered for a slot/scene index. No-op when
 *  there's no configurator for that index. Called on scene launch + at
 *  boot for slot 0 so the demo's preset selections actually take effect. */
export function runSlotConfigurator(state: LaneEngineHostState, idx: number): void {
  state.slotConfigurators[idx]?.();
}
