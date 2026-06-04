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

/** Mirror the per-voice drum mute map into engineState so muted voices persist
 *  across tab switches + save/load. Solo is live-only and never mirrored.
 *  No-op if the lane is unknown. */
export function mirrorDrumMutes(
  state: SessionState,
  laneId: string,
  mutes: Record<string, boolean>,
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.drumMutes = { ...mutes };
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
  // Spread the existing sampler sub-state so a keymap edit doesn't drop a
  // lane's drumkitId (and vice-versa in mirrorDrumkitId).
  lane.engineState.sampler = { ...lane.engineState.sampler, keymap };
}

/** Read a lane's persisted keymap (empty array if none). */
export function readLaneKeymap(state: SessionState, laneId: string): KeymapEntry[] {
  return state.lanes.find((l) => l.id === laneId)?.engineState?.sampler?.keymap ?? [];
}

/** Mirror which bundled drumkit a sampler lane uses (undefined = a plain
 *  melodic sampler). Stored alongside the keymap so the lane re-loads the kit
 *  by id on session/demo load. No-op if the lane is unknown. */
export function mirrorDrumkitId(state: SessionState, laneId: string, drumkitId: string | undefined): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  const keymap = lane.engineState.sampler?.keymap ?? [];
  lane.engineState.sampler = { keymap, ...(drumkitId ? { drumkitId } : {}) };
}

/** Read which bundled drumkit a sampler lane uses, if any. */
export function readLaneDrumkitId(state: SessionState, laneId: string): string | undefined {
  return state.lanes.find((l) => l.id === laneId)?.engineState?.sampler?.drumkitId;
}

/** Mirror the sampler's per-pad param overrides (keyed by note) so per-pad
 *  edits persist + survive a drumkit reload-by-id. */
export function mirrorPadParams(
  state: SessionState,
  laneId: string,
  padParams: Record<number, Record<string, number>>,
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  const keymap = lane.engineState.sampler?.keymap ?? [];
  lane.engineState.sampler = {
    ...lane.engineState.sampler,
    keymap,
    padParams: JSON.parse(JSON.stringify(padParams)),
  };
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
