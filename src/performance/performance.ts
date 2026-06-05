// Performance view data model. Pure types and pure helpers only — no audio
// side effects. Mirror role of session.ts for the Session view.

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

export function emptyArrangementState(bpm: number): ArrangementState {
  return { bpm, durationSec: 0, lengthBars: 0, lanes: [], globalAutomation: [] };
}

export function emptyLaneRec(laneId: string): ArrangementLaneRec {
  return { laneId, clipEvents: [], automation: [] };
}

/** 16th-notes per second at the given bpm. Mirrors the rest of the codebase
 *  (1 beat = 4 sixteenth steps). */
export function stepsPerSec(bpm: number): number {
  return (bpm / 60) * 4;
}
