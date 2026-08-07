// Crossfade two sets of hits.
//
// What A and B SHARE never moves. That shared skeleton is what holds the bar up
// while their differences hand over, and it is the whole reason this reads as a
// third rhythm rather than as two patterns playing at once. Halfway across, what
// plays is in neither library entry — which is the point, not a side effect.

import type { NoteEvent } from '../core/notes';
import { leavesAt, entersAt } from './metric-weight';

/** Same step AND same voice.
 *
 *  In percussion `midi` picks the drum, so a kick and a snare on the same step
 *  are two different hits. Keying on the step alone would collapse a backbeat
 *  into one and make half the kit disappear mid-crossfade. */
const hitKey = (n: NoteEvent) => `${n.start}:${n.midi}`;

export function blendRhythm(
  a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number,
): NoteEvent[] {
  const inA = new Set(a.map(hitKey));
  const inB = new Set(b.map(hitKey));
  const out: NoteEvent[] = [];

  for (const n of a) {
    if (inB.has(hitKey(n))) { out.push(n); continue; }   // shared: always sounds
    if (x < leavesAt(n.start, barTicks)) out.push(n);
  }
  for (const n of b) {
    // Shared hits were already emitted from A's side; emitting them again here
    // would double every note the two patterns agree on.
    if (inA.has(hitKey(n))) continue;
    if (x > entersAt(n.start, barTicks)) out.push(n);
  }

  return out.sort((p, q) => p.start - q.start);
}
