// Performance view data model. Pure types and pure helpers only — no audio
// side effects. Mirror role of session.ts for the Session view.

export interface ArrangementClipEvent {
  /** Stable identity — selection, per-band mute, drag and copy/paste hang off
   *  this, never off the array index. Generated at creation; backfilled for old
   *  saves by migrateArrangementBands. */
  id: string;
  clipId: string;
  laneId: string;
  atSec: number;
  untilSec: number;
  /** Where inside the clip this band starts (sec). Absent = 0. A left-trim
   *  moves atSec AND offsetSec together so the music does not change bars. */
  offsetSec?: number;
  /** The band exists but never fires. Painted dimmed; gated in tickArrangement. */
  muted?: boolean;
}

let bandSeq = 0;
export function newBandId(): string {
  return `band-${Date.now().toString(36)}-${(bandSeq++).toString(36)}`;
}

/** Load-time backfill: an arrangement written before bands had ids gets them
 *  generated here, so id-addressed editing works on it like on any other.
 *  Mutates in place (the caller owns the object) — mirrors migrateArrangementCurves.
 *
 *  Standing user rule: this is the ONE band migration and there will be no
 *  more. If it ever breaks, DELETE it rather than fix it — an old arrangement
 *  simply loses band editing until recreated. */
export function migrateArrangementBands(a: ArrangementState): void {
  for (const lane of a.lanes) {
    for (const ev of lane.clipEvents) {
      if (!(ev as { id?: string }).id) (ev as { id: string }).id = newBandId();
    }
  }
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

/** An arrangement does NOT carry the meter. Bars belong to the song, whose meter
 *  the Sequencer owns: the A–B window is written straight into the scene's
 *  global loop as bar numbers, and the ruler/playhead measure the same song
 *  Session measures. A copy here was a cache with four writers and no
 *  invalidation, so changing the meter from the (always visible) transport row
 *  while sitting in Performance left the two views decoding the same bars into
 *  different seconds. Every helper below takes the meter as an argument instead,
 *  which keeps this layer pure AND lets the compiler name every use site. */
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
