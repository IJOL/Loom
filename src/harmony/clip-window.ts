// The bars of a progression this iteration of a clip actually plays.
//
// The clip owns its LENGTH — `lane-scheduler` skips any note outside
// `[startTick, endTick)` and says so in as many words — and a progression owns
// its own. Nothing reconciled the two, so whichever was shorter silently won:
//
//   - A four-bar progression in a two-bar clip played its first two chords and
//     dropped the rest. The chord bar drew i-VI-III-VII while the music was
//     i-VI, for ever, and no chord after the second had ever been audible.
//   - A one-bar progression ("Stay home") in a two-bar clip left the second bar
//     empty. This one only failed once the harmony stopped being inferred:
//     inference measured the LEADER's material, so it happened to answer with
//     as many bars as the clip had, and the mismatch was hidden by luck.
//
// Both are the same question — which bars of the progression is this iteration
// on — and the lap answers it. Iteration k plays the `clipBars` bars starting
// at `k * clipBars`, walking the progression round and round. A short
// progression tiles; a long one is heard a window at a time, so all four
// chords of a four-bar progression reach a two-bar lane, two per lap.
//
// Pure: notes in, notes out.

import type { NoteEvent } from '../core/notes';

/**
 * `count` bars of `notes`, starting `startBar` into a progression that is
 * `srcBars` long and repeats for ever, rebased so the result starts at 0.
 *
 * Notes are placed by the bar their START falls in; a note held across a bar
 * line keeps its full duration and travels with its own bar, which is what
 * makes a pad's whole-chord stack survive being windowed.
 */
export function barsOfProgression(
  notes: readonly NoteEvent[], srcBars: number, startBar: number, count: number, barTicks: number,
): NoteEvent[] {
  if (srcBars <= 0 || count <= 0 || barTicks <= 0) return notes.map((n) => ({ ...n }));
  // Bucket once rather than scanning the whole part per output bar: a pad over
  // a long progression is a handful of notes, but a 16th comp over sixteen bars
  // is not, and this runs on the scheduler's tick.
  const byBar = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const bar = Math.floor(n.start / barTicks);
    if (bar < 0 || bar >= srcBars) continue;
    const list = byBar.get(bar);
    if (list) list.push(n); else byBar.set(bar, [n]);
  }

  const out: NoteEvent[] = [];
  for (let b = 0; b < count; b++) {
    const src = (((startBar + b) % srcBars) + srcBars) % srcBars;
    for (const n of byBar.get(src) ?? []) {
      // The note's offset within its own bar, moved to the bar it now occupies.
      out.push({ ...n, start: n.start - src * barTicks + b * barTicks });
    }
  }
  return out;
}
