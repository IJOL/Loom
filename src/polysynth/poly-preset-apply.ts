// src/polysynth/poly-preset-apply.ts
//
// The three ways a poly lane's sound changes with nobody touching a knob:
// recalling a factory/engine preset, loading a user subtractive preset, and
// Randomize. All three push values straight into the engine, so no knob onChange
// fires and `commitParam` never sees them — each must therefore COMMIT what it
// applied (`commitEngineBaseValues`) or the new sound never reaches a save. The
// live preset picker does not set `lane.enginePresetName` either (only
// engine-swap, the drum-kit picker and the MIDI importer do), so the mirror is
// the lane's ONLY vehicle to disk.
//
// They live here, apart from the DOM-heavy preset UI, so the invariant is
// testable without a document: the caller passes the session in, and the mirror
// respects `withoutParamMirror` exactly like every other commit does.

import { POLY_DEFAULTS, type PolySynth, type PolySynthParams } from './polysynth';
import { polyParamsToFlat } from './poly-preset-store';
import { randomizePolySynth } from '../core/random';
import { commitEngineBaseValues } from '../engines/engine-param-commit';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionState } from '../session/session';

export interface PolyPresetApplyDeps {
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  /** The live session, so an apply can mirror its result into the lane. */
  getSessionState: () => SessionState | undefined;
  /** Push the engine's new base values back into the lane's knob handles. */
  refreshLaneKnobs: (laneId: string) => void;
}

/** Mirror what the engine now holds, then repaint the lane's knobs from it.
 *  Order matters only for readability — the repaint is display-only (it runs
 *  inside `withoutParamMirror`) and cannot write anything back. */
function settle(deps: PolyPresetApplyDeps, laneId: string, engine: SynthEngine): void {
  commitEngineBaseValues(engine, deps.getSessionState(), laneId);
  deps.refreshLaneKnobs(laneId);
}

/** Apply a factory/engine preset by name to a lane's engine.
 *
 *  Delegates to `engine.applyPreset` — the SAME path the session/scene loader
 *  uses (preset-apply.ts::applyPresetToEngine). Each engine owns the mapping
 *  from its preset JSON keys to its internal state; a generic
 *  `setBaseValue(jsonKey, value)` loop here is WRONG because some engines'
 *  preset keys are not setBaseValue ids (tb303: `cutoff`/`envMod`… vs
 *  `filter.cutoff`/`env.amount`; drums: `kitId`) — those silently no-op, which
 *  is why changing a 303 preset once did nothing. */
export function applyEnginePresetToLane(
  deps: PolyPresetApplyDeps,
  laneId: string,
  presetName: string,
): void {
  const engine = deps.getLaneEngineInstance(laneId);
  if (!engine) return;
  engine.applyPreset(presetName);
  settle(deps, laneId, engine);
}

/** Apply a USER subtractive preset (stored as nested PolySynthParams) to a
 *  lane's worklet engine: flatten to dot-ids and setBaseValue each. The Phase 4
 *  cutover removed the PolySynth target these used to write to. */
export function applyUserPolyPresetToLane(
  deps: PolyPresetApplyDeps,
  laneId: string,
  params: PolySynthParams,
): void {
  const engine = deps.getLaneEngineInstance(laneId);
  if (!engine) return;
  for (const [id, v] of Object.entries(polyParamsToFlat(params))) engine.setBaseValue(id, v);
  settle(deps, laneId, engine);
}

/** Randomize a subtractive lane. After the Phase 4 cutover subtractive lanes
 *  have no PolySynth, so randomize a scratch PolySynthParams bag
 *  (`randomizePolySynth` only mutates `.params` — no audio nodes), flatten to
 *  dot-ids and push to the worklet engine. */
export function randomizeSubtractiveLane(deps: PolyPresetApplyDeps, laneId: string): void {
  const scratch = { params: JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams } as PolySynth;
  randomizePolySynth(scratch);
  applyUserPolyPresetToLane(deps, laneId, scratch.params);
}
