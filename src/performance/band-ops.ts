// Pure band operations addressed by ID — the identity Task 1 gave every band.
// All ops take one lane's clipEvents and return a NEW array (never mutate);
// an op that cannot apply returns the input array unchanged.
import { newBandId, type ArrangementClipEvent, type ArrangementLaneRec } from './performance';
import { snapSecToBeat } from './arrangement-edit';

/** Resolve a band id to its lane record + index, across every lane. */
export function findBand(
  lanes: readonly ArrangementLaneRec[], bandId: string,
): { lane: ArrangementLaneRec; index: number } | null {
  for (const lane of lanes) {
    const index = lane.clipEvents.findIndex((e) => e.id === bandId);
    if (index >= 0) return { lane, index };
  }
  return null;
}

export function setBandMuted(
  events: ArrangementClipEvent[], bandId: string, muted: boolean,
): ArrangementClipEvent[] {
  return events.map((e) => (e.id === bandId ? { ...e, muted } : e));
}

/** Copy placed right after the original — refused when the gap to the next
 *  band is smaller than the band itself. */
export function duplicateBand(
  events: ArrangementClipEvent[], bandId: string,
): ArrangementClipEvent[] {
  const cur = events.find((e) => e.id === bandId);
  if (!cur) return events;
  const dur = cur.untilSec - cur.atSec;
  const at = cur.untilSec;
  const collision = events.some((e) => e.id !== bandId && e.atSec < at + dur && e.untilSec > at);
  if (collision) return events;
  return [...events, { ...cur, id: newBandId(), atSec: at, untilSec: at + dur }];
}

/** Two bands out of one. The right half starts where the cut fell and carries
 *  offsetSec = original offset + the seconds cut away, so the music under the
 *  playhead does not move. A cut outside (atSec, untilSec) is a no-op. */
export function splitBandAt(
  events: ArrangementClipEvent[], bandId: string, atSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events.find((e) => e.id === bandId);
  if (!cur) return events;
  const cut = snapSecToBeat(atSec, bpm);
  if (cut <= cur.atSec || cut >= cur.untilSec) return events;
  const left = { ...cur, untilSec: cut };
  const right = {
    ...cur, id: newBandId(), atSec: cut,
    offsetSec: (cur.offsetSec ?? 0) + (cut - cur.atSec),
  };
  return events.flatMap((e) => (e.id === bandId ? [left, right] : [e]));
}

/** Left-edge trim: atSec and offsetSec move by the SAME delta, so trimming
 *  reveals or covers material instead of shifting it. Clamped to offset >= 0
 *  (you can only reveal what exists) and to at least one beat of band. */
export function trimBandStart(
  events: ArrangementClipEvent[], bandId: string, newAtSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events.find((e) => e.id === bandId);
  if (!cur) return events;
  const beat = 60 / bpm;
  const offset = cur.offsetSec ?? 0;
  let at = snapSecToBeat(newAtSec, bpm);
  at = Math.max(at, cur.atSec - offset);       // cannot reveal before the clip's start
  at = Math.min(at, cur.untilSec - beat);      // keep at least one beat
  const delta = at - cur.atSec;
  const trimmed = { ...cur, atSec: at, offsetSec: offset + delta };
  return events.map((e) => (e.id === bandId ? trimmed : e));
}
