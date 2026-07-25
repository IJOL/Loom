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

export function commitParam(
  engine: { setBaseValue(id: string, v: number): void },
  ctx: EngineUIContext,
  paramId: string,
  value: number,
): void {
  engine.setBaseValue(paramId, value);
  if (ctx.sessionState) mirrorParamChange(ctx.sessionState, ctx.laneId, paramId, value);
}
