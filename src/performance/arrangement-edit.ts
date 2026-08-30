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

export type MoveMode = 'clamp' | 'ripple';

/** Free placement: the band lands where dropped; a collision clamps it against
 *  the neighbour (duration preserved); a hole too small refuses the move. The
 *  DAW default since the Arrange round — ripple survives behind Shift. */
export function clampMove(
  events: ArrangementClipEvent[], index: number, newAtSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events[index];
  if (!cur) return events;
  const dur = cur.untilSec - cur.atSec;
  let at = Math.max(0, snapSecToBeat(newAtSec, bpm));
  const others = events.filter((_, i) => i !== index).sort((a, b) => a.atSec - b.atSec);
  const prev = [...others].reverse().find((e) => e.atSec <= at);
  if (prev && at < prev.untilSec) at = prev.untilSec;          // pushed off the previous band
  const next = others.find((e) => e.atSec >= at);
  if (next && at + dur > next.atSec) at = next.atSec - dur;    // pulled back off the next one
  // Both clamps applied and still colliding (or off the left edge): the hole is
  // smaller than the band — refuse rather than overlap.
  if (at < 0 || (prev && at < prev.untilSec)) return events;
  const moved = { ...cur, atSec: at, untilSec: at + dur };
  return events.map((e, i) => (i === index ? moved : e));
}

export function moveEvent(
  events: ArrangementClipEvent[], index: number, newAtSec: number, bpm: number,
  mode: MoveMode = 'clamp',
): ArrangementClipEvent[] {
  if (mode === 'clamp') return clampMove(events, index, newAtSec, bpm);
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
  // Clamp against neighbours instead of rippling: an end-edge grows at most to
  // the next band's start, a start-edge shrinks at most back to the previous
  // band's end. Resizing never moves ANOTHER band.
  const others = events.filter((_, i) => i !== index);
  const nextBand = others.filter((e) => e.atSec >= cur.untilSec).sort((a, b) => a.atSec - b.atSec)[0];
  const prevBand = others.filter((e) => e.untilSec <= cur.atSec).sort((a, b) => b.untilSec - a.untilSec)[0];
  if (edge === 'end' && nextBand && resized.untilSec > nextBand.atSec) {
    resized = { ...resized, untilSec: nextBand.atSec };
  }
  if (edge === 'start' && prevBand && resized.atSec < prevBand.untilSec) {
    resized = { ...resized, atSec: prevBand.untilSec };
  }
  return events.map((e, i) => (i === index ? resized : e));
}

export function deleteEvent(
  events: ArrangementClipEvent[], index: number,
): ArrangementClipEvent[] {
  return events.filter((_, i) => i !== index);
}
