// src/polysynth/poly-preset-apply.ts
//
// Two ways a poly lane's sound changes with nobody touching a knob: recalling a
// factory/engine preset, and loading a user subtractive preset. Both push values
// straight into the engine, so no knob onChange fires and `commitParam` never
// sees them — each must therefore COMMIT what it applied
// (`commitEngineBaseValues`) or the new sound never reaches a save. The live
// preset picker does not set `lane.enginePresetName` either (only engine-swap,
// the drum-kit picker and the MIDI importer do), so the mirror is the lane's
// ONLY vehicle to disk.
//
// Randomize used to be the third, as `randomizeSubtractiveLane` — a
// subtractive-only path that rolled a fresh bag from POLY_DEFAULTS while every
// other engine fell through to a `randomize?.()`/`setParam?.()` pair that no
// engine implemented (REMAINING-WORK's "do not let it keep lying"). It is now
// one shared dice over the engine's declared params, so it lives with the
// engines (engines/engine-randomize.ts) rather than here.
//
// These live apart from the DOM-heavy preset UI so the invariant is testable
// without a document: the caller passes the session in, and the mirror respects
// `withoutParamMirror` exactly like every other commit does.

import type { PolySynthParams } from './poly-params';
import { polyParamsToFlat } from './poly-preset-store';
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

/** Apply a USER preset to a lane's engine: setBaseValue each id, then settle.
 *
 *  Unlike a factory preset this does NOT go through `engine.applyPreset`, and
 *  the difference is deliberate: a factory preset's JSON keys are the engine's
 *  own preset vocabulary, which is not always its setBaseValue vocabulary. A
 *  user preset is a snapshot of setBaseValue ids by construction
 *  (`snapshotEngineParams`), so setting them back is exact. Ids the engine no
 *  longer declares are simply values it will not read. */
export function applyUserPresetToLane(
  deps: PolyPresetApplyDeps,
  laneId: string,
  params: Record<string, number>,
): void {
  const engine = deps.getLaneEngineInstance(laneId);
  if (!engine) return;
  for (const [id, v] of Object.entries(params)) engine.setBaseValue(id, v);
  settle(deps, laneId, engine);
}

/** Apply a USER subtractive preset in the pre-`user-preset-store` nested shape.
 *  Kept for callers that still hold a `PolySynthParams`; the store hands out
 *  flat bags, so new code wants `applyUserPresetToLane`. */
export function applyUserPolyPresetToLane(
  deps: PolyPresetApplyDeps,
  laneId: string,
  params: PolySynthParams,
): void {
  applyUserPresetToLane(deps, laneId, polyParamsToFlat(params));
}

