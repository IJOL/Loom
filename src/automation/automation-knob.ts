// src/automation/automation-knob.ts
// Landing an automation value on its target, mounted or not: the knob when one
// is on screen, the audio object directly when it is not.
//
// The mounted branch of both automation players — per-clip envelopes
// (automation-tick) and Performance take curves (performance-feature) — does the
// same two things: denormalise 0..1 against the handle's declared range, and
// move the handle. Driving the handle is what makes the UI follow, but a
// handle's setValue fires the same onChange a user drag does, and that onChange
// mirrors into `lane.engineState.params`. Automation must NOT: a curve belongs
// to the clip or to the take, both of which already store it, so stamping it
// into the lane would make a save taken after playback record wherever the
// envelope happened to stop rather than the sound the user dialled in — and
// replaying the take would then start from a different base every time.
//
// The unmounted branches (applyAutomationToSession) write the engine directly
// and never mirrored, so this keeps both branches telling one story.

import { withoutParamMirror } from '../session/session-engine-state';
import type { KnobHandle } from '../core/knob';

/** Drive a mounted knob from an automation value (0..1), display included, with
 *  the engineState mirror suppressed. Returns false when no knob is mounted for
 *  `paramId`, so landAutomationValue (the only caller) can fall through to its
 *  unmounted path. */
function driveKnobFromAutomation(
  registry: ReadonlyMap<string, KnobHandle>,
  paramId: string,
  normalised: number,
): boolean {
  const k = registry.get(paramId);
  if (!k) return false;
  withoutParamMirror(() => k.setValue(k.meta.min + normalised * (k.meta.max - k.meta.min)));
  return true;
}

export interface LandingDeps {
  registry: ReadonlyMap<string, KnobHandle>;
  /** Where a value goes when no knob is mounted. Absent in test fixtures that
   *  do not build an audio graph, in which case the write is dropped — the
   *  behaviour every caller had before this existed. */
  applyUnmounted?: (
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
  getTargetRanges?: () => ReadonlyMap<string, { min: number; max: number }>;
}

/** Land an automation value on its target: the mounted knob when there is one
 *  (so the UI follows), the audio object itself when there is not. Automation
 *  is a property of the session, not of what happens to be on screen — the two
 *  players used to disagree about that, and the take player simply dropped the
 *  value. Callers that land many values in one frame should memoise
 *  `getTargetRanges` themselves; this function calls it at most once per value
 *  and only when it is needed. */
export function landAutomationValue(
  deps: LandingDeps, paramId: string, normalised: number,
): void {
  if (driveKnobFromAutomation(deps.registry, paramId, normalised)) return;
  if (!deps.applyUnmounted || !deps.getTargetRanges) return;
  deps.applyUnmounted(paramId, normalised, deps.getTargetRanges());
}
