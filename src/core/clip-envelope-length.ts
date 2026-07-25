// The one owner of "how long is a clip's automation envelope, and which slot is
// playing right now".
//
// A clip envelope is a flat array of sub-samples: AUTOMATION_SUB_RES of them per
// 16th-note step, and stepsPerBar(meter) steps per bar. Six places used to spell
// that out themselves with a hardcoded 16 steps per bar, while the note editors
// and the lane scheduler read stepsPerBar(meter). In 4/4 the two agree, which is
// why the copies never drifted from each other; in any other meter the envelope
// wrapped on a different period than the clip it belongs to (lane-scheduler.ts
// loops every `lengthBars * ticksPerBar(meter)`), so the curve slid a bar per lap
// and the lane drew bar lines the piano roll above did not have.
//
// envelopeSubIndex is built ON TOP of envelopeValueLength on purpose: the array
// that is stored and the index that reads it come from one expression, so a
// future change cannot move one without the other.

import { stepsPerBar, DEFAULT_METER, type TimeSignature } from './meter';
import { AUTOMATION_SUB_RES } from './pattern';
import { TICKS_PER_STEP } from './notes';

/** At least one step: a zero-bar clip should not exist, and an empty envelope is
 *  not a value any consumer can read (the live tick and the offline collector
 *  both already guarded for it; the creation path did not). */
function stepsFrom(lengthBars: number, perBar: number): number {
  return Math.max(1, Math.round(lengthBars * perBar));
}

/** 16th-note steps the envelope of a `lengthBars` clip covers. */
export function envelopeStepCount(lengthBars: number, meter?: TimeSignature): number {
  return stepsFrom(lengthBars, stepsPerBar(meter ?? DEFAULT_METER));
}

/** Length of the `values` array every consumer expects for that clip. */
export function envelopeValueLength(lengthBars: number, meter?: TimeSignature): number {
  return envelopeStepCount(lengthBars, meter) * AUTOMATION_SUB_RES;
}

/** The same length for a caller that holds the bar in TICKS rather than as a
 *  meter — scaleClipTempo is handed `ticksPerBar(meter)` by its caller and never
 *  sees the meter itself. Same grid, expressed in the unit it already has. */
export function envelopeValueLengthFromBarTicks(lengthBars: number, barTicks: number): number {
  return stepsFrom(lengthBars, barTicks / TICKS_PER_STEP) * AUTOMATION_SUB_RES;
}

/** Sub-sample `elapsedSec` points at, wrapped by the clip's own length — the same
 *  period lane-scheduler.ts loops the clip on. */
export function envelopeSubIndex(
  elapsedSec: number, bpm: number, lengthBars: number, meter?: TimeSignature,
): number {
  const totalSubs = envelopeValueLength(lengthBars, meter);
  const stepDur = 60 / bpm / 4;
  if (!(stepDur > 0)) return 0;
  const stepsElapsed = Math.max(0, elapsedSec / stepDur);
  return Math.floor(stepsElapsed * AUTOMATION_SUB_RES) % totalSubs;
}
