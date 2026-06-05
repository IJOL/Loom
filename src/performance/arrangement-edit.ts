// Pure editing math for the arrangement timeline. Operates on ArrangementClipEvent[]
// (one lane's bands), always returns a NEW array (never mutates input). Seconds in,
// seconds out; bpm drives the beat snap. Ripple pushes overlapping bands forward so a
// lane stays ordered by atSec with no overlaps.
import type { ArrangementClipEvent } from './performance';

export function snapSecToBeat(sec: number, bpm: number): number {
  const beat = 60 / bpm;
  return Math.round(sec / beat) * beat;
}

/** Sort by atSec and push any band that overlaps its predecessor forward to the
 *  predecessor's untilSec (keeping its own duration), cascading. Pure. */
function rippleForward(events: ArrangementClipEvent[]): ArrangementClipEvent[] {
  const out = [...events].sort((a, b) => a.atSec - b.atSec);
  for (let i = 1; i < out.length; i++) {
    if (out[i].atSec < out[i - 1].untilSec) {
      const dur = out[i].untilSec - out[i].atSec;
      const at = out[i - 1].untilSec;
      out[i] = { ...out[i], atSec: at, untilSec: at + dur };
    }
  }
  return out;
}

export function moveEvent(
  events: ArrangementClipEvent[], index: number, newAtSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events[index];
  if (!cur) return events;
  const dur = cur.untilSec - cur.atSec;
  const at = Math.max(0, snapSecToBeat(newAtSec, bpm));
  const moved = { ...cur, atSec: at, untilSec: at + dur };
  const next = events.map((e, i) => (i === index ? moved : e));
  return rippleForward(next);
}

export function resizeEvent(
  events: ArrangementClipEvent[], index: number, edge: 'start' | 'end', newSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events[index];
  if (!cur) return events;
  const beat = 60 / bpm;
  const snapped = snapSecToBeat(newSec, bpm);
  let resized: ArrangementClipEvent;
  if (edge === 'start') {
    const at = Math.max(0, Math.min(snapped, cur.untilSec - beat));
    resized = { ...cur, atSec: at };
  } else {
    const until = Math.max(cur.atSec + beat, snapped);
    resized = { ...cur, untilSec: until };
  }
  const next = events.map((e, i) => (i === index ? resized : e));
  return rippleForward(next);
}

export function deleteEvent(
  events: ArrangementClipEvent[], index: number,
): ArrangementClipEvent[] {
  return events.filter((_, i) => i !== index);
}
