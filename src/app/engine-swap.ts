// src/app/engine-swap.ts
// Orchestrates changing the synth engine of an existing session lane:
// resets the lane's sound to the new engine's defaults, reconciles clip
// automation envelopes, swaps the live audio engine (keeping the channel
// strip + inserts), refreshes the UI, and persists. Pure WRT globals: every
// registry / DOM / audio dependency is injected so it unit-tests with doubles.

import type { SessionState } from '../session/session';
import { reconcileLaneEnvelopes } from '../session/session';

export interface EngineSwapDeps {
  state: SessionState;
  /** Editor kind for an engineId ('piano-roll' | 'drum-grid' | undefined). */
  getEngineEditor: (engineId: string) => 'piano-roll' | 'drum-grid' | undefined;
  /** Automatable paramIds the engine exposes (for envelope reconciliation). */
  getEngineParamIds: (engineId: string) => ReadonlySet<string>;
  /** Replace the live audio engine for the lane (allocator.swapLaneEngine). */
  swapLaneEngine: (laneId: string, newEngineId: string) => void;
  /** Re-route the editor to the new engine's page, rebuild panels, and sync
   *  the engine selectors. */
  onSwapped: (laneId: string, newEngineId: string) => void;
  /** Persist the session (autosave). Optional. */
  saveSession?: () => void;
}

/** Change a lane's engine in place. Returns true if the swap happened, false
 *  if a guard rejected it (same engine, non-melodic source or target,
 *  unknown lane). Callers wrap this in withUndo so it is one undo entry. */
export function swapLaneEngineFlow(
  deps: EngineSwapDeps,
  laneId: string,
  newEngineId: string,
): boolean {
  const lane = deps.state.lanes.find((l) => l.id === laneId);
  if (!lane) return false;
  if (lane.engineId === newEngineId) return false;                        // same engine
  // An audio channel is not a swappable instrument (and a synth can't become one).
  if (lane.engineId === 'audio' || newEngineId === 'audio') return false;
  if (deps.getEngineEditor(newEngineId) !== 'piano-roll') return false;   // target not melodic
  if (deps.getEngineEditor(lane.engineId) !== 'piano-roll') return false; // source is drums

  // 1. State: switch engine, reset sound + preset to the new engine's defaults.
  lane.engineId = newEngineId;
  lane.engineState = {};
  lane.enginePresetName = undefined;

  // 2. Clips: keep notes; reconcile automation envelopes against the new set.
  reconcileLaneEnvelopes(lane, deps.getEngineParamIds(newEngineId));

  // 3. Audio: replace the live engine (strip + inserts preserved).
  deps.swapLaneEngine(laneId, newEngineId);

  // 4. UI: re-route page, rebuild panels, sync selectors.
  deps.onSwapped(laneId, newEngineId);

  // 5. Persist.
  deps.saveSession?.();
  return true;
}
