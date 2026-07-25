// Performance view data model. Pure types and pure helpers only — no audio
// side effects. Mirror role of session.ts for the Session view.

import { DEFAULT_METER, type TimeSignature } from '../core/meter';

export interface ArrangementClipEvent {
  clipId: string;
  laneId: string;
  atSec: number;
  untilSec: number;
}

export interface AutomationCurve {
  paramId: string;
  /** Normalized 0..1 per sub-step at AUTOMATION_SUB_RES at the arrangement's
   *  bpm. Length = ceil(effectiveDurationSec * stepsPerSec * AUTOMATION_SUB_RES). */
  values: number[];
  /** undefined/true = applied during playback; false = muted. */
  enabled?: boolean;
  /** snap-to-step while drawing (mirrors clip envelopes / global tab). */
  stepped?: boolean;
}

export interface ArrangementLaneRec {
  laneId: string;
  clipEvents: ArrangementClipEvent[];
  automation: AutomationCurve[];
}

export interface ArrangementState {
  bpm: number;
  /** The session meter this take measures its bars with. Optional so a save
   *  written before the field (and every test literal that casts its way into
   *  this shape) still loads: every reader goes through
   *  `songBarSec(bpm, meter)`, whose default absorbs the absence. Without it the
   *  view could not be meter-aware at all and decoded the SAME A–B bars as
   *  Session with a different bar length. */
  meter?: TimeSignature;
  durationSec: number;
  /** User-set length in bars (toolbar). 0 = unset. Render/curve sizing use
   *  effectiveDurationSec = max(durationSec, lengthBars * barSec). */
  lengthBars: number;
  lanes: ArrangementLaneRec[];
  globalAutomation: AutomationCurve[];
  /** A–B loop (Phase B). When loopEnabled, playback repeats [loopStartBar,
   *  loopEndBar) instead of stopping at the end. Bars; absent ⇒ no loop. */
  loopEnabled?: boolean;
  loopStartBar?: number;
  loopEndBar?: number;
}

export function emptyArrangementState(
  bpm: number, meter: TimeSignature = DEFAULT_METER,
): ArrangementState {
  // A COPY of the meter: the arrangement is snapshotted/restored wholesale by
  // its undo stack, and it must never alias (and so never mutate) seq.meter.
  return { bpm, meter: { ...meter }, durationSec: 0, lengthBars: 0, lanes: [], globalAutomation: [] };
}

export function emptyLaneRec(laneId: string): ArrangementLaneRec {
  return { laneId, clipEvents: [], automation: [] };
}

/** 16th-notes per second at the given bpm. Mirrors the rest of the codebase
 *  (1 beat = 4 sixteenth steps). */
export function stepsPerSec(bpm: number): number {
  return (bpm / 60) * 4;
}
