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
  /** Samples at AUTOMATION_SUB_RES per 16th-step at the arrangement's bpm.
   *  Length = ceil(durationSec * stepsPerSec * AUTOMATION_SUB_RES). */
  samples: number[];
}

export interface ArrangementLaneRec {
  laneId: string;
  clipEvents: ArrangementClipEvent[];
  automation: AutomationCurve[];
}

export interface ArrangementState {
  bpm: number;
  durationSec: number;
  lanes: ArrangementLaneRec[];
  globalAutomation: AutomationCurve[];
}

export function emptyArrangementState(bpm: number): ArrangementState {
  return { bpm, durationSec: 0, lanes: [], globalAutomation: [] };
}

export function emptyLaneRec(laneId: string): ArrangementLaneRec {
  return { laneId, clipEvents: [], automation: [] };
}

/** 16th-notes per second at the given bpm. Mirrors the rest of the codebase
 *  (1 beat = 4 sixteenth steps). */
export function stepsPerSec(bpm: number): number {
  return (bpm / 60) * 4;
}
