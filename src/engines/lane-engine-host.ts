import type { Sequencer } from '../core/sequencer';

// ── Per-lane engine management ────────────────────────────────────────────
// After Phase B every lane already has a SynthEngine in `laneResources`.
// This module now only tracks active-lane UI state; engine lifecycle is
// handled by laneResources (see src/core/lane-resources.ts).

export interface LaneEngineHostState {
  /** The lane currently painted on the INSTRUMENT page. Not "the selected
   *  lane": selecting a drum lane routes to the drums page and deliberately
   *  leaves this pointing at the last melodic lane. Pointing it at a drum lane
   *  would blank the engine dropdown (drums-machine is not among its options),
   *  mount the instrument page's FX panel under the drum lane's id, repopulate
   *  the melodic preset dropdown for it, and aim the engine-swap dropdown at
   *  it. Written only by setActiveEngineLane, which showLaneEditor calls only
   *  on the instrument-page branch. */
  instrumentPageLaneId: string;
}

export interface LaneEngineHostDeps {
  seq: Sequencer;
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
    instrumentPageLaneId: 'subtractive-1', // matches the default-active session lane
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
  state.instrumentPageLaneId = laneId;
  const id = getLaneEngineId(state, deps, laneId);
  deps.engineSel.value = id;
  const laneLabel = document.getElementById('engine-lane-label');
  if (laneLabel) {
    laneLabel.textContent = deps.laneLabels[laneId] ?? laneId;
  }
  deps.rebuildEngineParamUI();
}

