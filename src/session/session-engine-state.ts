// src/session/session-engine-state.ts
// Mirrors engine knob + modulator state into SessionLane.engineState so each
// lane's sound persists across tab switches and save/load. Phase C of the
// lane resource unification refactor.

import type { SessionState } from './session';
import type { ModulatorState } from '../modulation/types';
import type { KeymapEntry } from '../samples/types';
import type { NoteFxState } from '../notefx/notefx-types';

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

/** Mirror the lane's one-shot keymap into engineState so it survives tab
 *  switches and save/load. No-op if the lane is unknown. */
export function mirrorKeymapChange(
  state: SessionState,
  laneId: string,
  keymap: KeymapEntry[],
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.sampler = { keymap };
}

/** Read a lane's persisted keymap (empty array if none). */
export function readLaneKeymap(state: SessionState, laneId: string): KeymapEntry[] {
  return state.lanes.find((l) => l.id === laneId)?.engineState?.sampler?.keymap ?? [];
}

/** Writes a deep-cloned copy of the note-FX array into
 *  `state.lanes[laneId].engineState.noteFx`. No-op if lane is unknown. */
export function syncNoteFx(
  state: SessionState,
  laneId: string,
  noteFx: NoteFxState[],
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.noteFx = JSON.parse(JSON.stringify(noteFx));
}
