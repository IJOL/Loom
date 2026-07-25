// src/automation/automation-knob.ts
// Landing an automation value on a knob that IS on screen.
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
 *  `paramId`, so the caller can run its own unmounted fallback. */
export function driveKnobFromAutomation(
  registry: ReadonlyMap<string, KnobHandle>,
  paramId: string,
  normalised: number,
): boolean {
  const k = registry.get(paramId);
  if (!k) return false;
  withoutParamMirror(() => k.setValue(k.meta.min + normalised * (k.meta.max - k.meta.min)));
  return true;
}
