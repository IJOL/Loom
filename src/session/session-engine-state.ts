// src/session/session-engine-state.ts
// Mirrors engine knob + modulator state into SessionLane.engineState so each
// lane's sound persists across tab switches and save/load. Phase C of the
// lane resource unification refactor.

import type { SessionState } from './session';
import type { ModulatorState } from '../modulation/types';

/** Writes a deep-cloned copy of the modulator array into
 *  `state.lanes[laneId].engineState.modulators`. No-op if lane is unknown.
 *  Deep clone via JSON so later mutations on the source don't leak into
 *  the saved state (mods are POJOs with no functions). */
export function syncModulators(
  state: SessionState,
  laneId: string,
  modulators: ModulatorState[],
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.modulators = JSON.parse(JSON.stringify(modulators));
}

/** Writes `value` into `state.lanes[laneId].engineState.params[paramId]`,
 *  creating intermediate objects as needed. No-op if the lane is unknown. */
export function mirrorParamChange(
  state: SessionState,
  laneId: string,
  paramId: string,
  value: number,
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  if (!lane.engineState.params) lane.engineState.params = {};
  lane.engineState.params[paramId] = value;
}
