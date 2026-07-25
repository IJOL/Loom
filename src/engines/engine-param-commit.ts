// src/engines/engine-param-commit.ts
// The single write path for an engine param edited from the UI: push the value
// into the engine AND mirror it into `lane.engineState.params`.
//
// That mirror is the ONLY vehicle by which a knob value reaches a save, and a
// builder that forgot it threw the edit away silently: engine-param-grid.ts
// (fm / wavetable / karplus / westcoast / tb303) and the hand-rolled VOICES knob
// both wrote only to the engine, so those tweaks vanished on reload. Routing
// every UI builder through one seam means no future control can forget.
//
// `ctx.sessionState` is optional on purpose: the offline export path builds
// engines with no session at all and must still be able to set base values.

import { mirrorParamChange } from '../session/session-engine-state';
import type { EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { SessionState } from '../session/session';

export function commitParam(
  engine: { setBaseValue(id: string, v: number): void },
  ctx: EngineUIContext,
  paramId: string,
  value: number,
): void {
  commitParamForLane(engine, ctx.sessionState, ctx.laneId, paramId, value);
}

/** `commitParam` for a caller that holds the session directly rather than a UI
 *  context — a control surface writing a param whose knob is not mounted (the
 *  lane's editor is closed). Same hardware gesture, same persistence, whether or
 *  not the panel happens to be on screen. */
export function commitParamForLane(
  engine: { setBaseValue(id: string, v: number): void },
  sessionState: SessionState | undefined,
  laneId: string,
  paramId: string,
  value: number,
): void {
  engine.setBaseValue(paramId, value);
  if (sessionState) mirrorParamChange(sessionState, laneId, paramId, value);
}

/** Mirror EVERY declared param's current base value into the lane's engineState.
 *
 *  The bulk sibling, for the programmatic applies that move a whole sound at
 *  once — recalling a preset, loading a user preset, Randomize. Those push
 *  values straight into the engine, so no knob onChange fires and `commitParam`
 *  never runs; they used to lean on `refreshLaneKnobs` repainting the knobs to
 *  produce the mirror as a side effect, which stopped being true the moment that
 *  repaint was (correctly) wrapped in `withoutParamMirror`. Nothing else writes
 *  a melodic lane's sound to disk: `enginePresetName` is set only by
 *  engine-swap, the drum-kit picker and the MIDI importer, never by the live
 *  preset picker.
 *
 *  Reads the engine back rather than taking the values it was handed, so a
 *  preset whose keys are not setBaseValue ids (tb303, drums) still mirrors what
 *  the engine actually ended up holding. Suppressed by `withoutParamMirror`, so
 *  the load path can apply a lane's preset without clobbering the saved params
 *  it is about to replay. */
export function commitEngineBaseValues(
  engine: { params: readonly EngineParamSpec[]; getBaseValue(id: string): number },
  sessionState: SessionState | undefined,
  laneId: string,
): void {
  if (!sessionState) return;
  for (const spec of engine.params) {
    mirrorParamChange(sessionState, laneId, spec.id, engine.getBaseValue(spec.id));
  }
}
