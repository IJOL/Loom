// What chords a melody implies.
//
// This replaces the per-bar frequency vote in core/harmony.ts, which counted
// scale-degree occurrences and took the winner. That vote has no idea where a
// note fell or how long it lasted, so a sixteenth of passing tone off the beat
// carried exactly the weight of a whole-bar tonic on the downbeat — and with no
// inertia, a one-vote margin was enough to move the harmony every bar.
//
// Pure: notes in, a progression out. The SAME `Chord[]` a hand-written
// progression uses, so what is inferred and what is written are one kind of
// thing and the panel, the fold and the editor all read them the same way.

import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { midiToScaleDegree, scaleIntervals, type ScaleId } from '../core/musicality';
import { metricWeight } from '../weave/metric-weight';
import type { Chord } from '../arranger/progression';

export interface InferOptions {
  key: number;
  scale: ScaleId;
  barTicks: number;
  bars: number;
  /** How much staying put is worth, as a fraction of the bar's own weight.
   *  0 disables it and the analysis is memoryless. */
  inertia?: number;
  /** How much the last bar prefers V or I, in the same units. 0 disables it. */
  cadence?: number;
}

/** What a note contributes: where it falls, times how long it holds.
 *
 *  Multiplied rather than added because they are not two votes — they are one
 *  question ("how much does this note assert itself?") asked twice. A long note
 *  in a weak position and a short one on the downbeat both land in the middle,
 *  which is where the ear puts them.
 *
 *  Duration is measured in sixteenths and capped at the bar: a note held across
 *  the bar line belongs to this bar for as long as this bar lasts, and no more. */
function noteWeight(startInBar: number, duration: number, barTicks: number): number {
  const steps = Math.max(1, Math.min(duration, barTicks) / TICKS_PER_STEP);
  return metricWeight(startInBar, barTicks) * steps;
}

/** The degree classes a triad on `degree` covers, in a scale of `len` degrees. */
function triadClasses(degree: number, len: number): Set<number> {
  return new Set([0, 2, 4].map((o) => (((degree + o) % len) + len) % len));
}

/** Material a candidate does NOT explain costs this much of its own weight.
 *
 *  Less than 1 on purpose. A chord is not disproved by a note outside it —
 *  every real melody passes through tones its harmony does not contain. What
 *  makes the discount safe is that `noteWeight` has already shrunk exactly the
 *  notes that ARE passing tones: short, off the beat, small weight. There is no
 *  separate "is this a passing note?" rule because there does not need to be. */
const OUTSIDE_COST = 0.5;

const DEFAULT_INERTIA = 0.15;

/** How much the final bar leans towards V or I.
 *
 *  Smaller than the inertia bonus deliberately: a cadence is a preference
 *  between candidates the material already supports, not a rule that overrides
 *  what the melody plainly says. A phrase that ends firmly somewhere else still
 *  ends there.
 *
 *  It was 0.2 and 0.2 did override. Measured against four progressions we KNOW
 *  — every melodic loop on the shelf transposed onto each, then read back — the
 *  whole progression came out right 63% of the time with no bonus at all and
 *  50% with 0.2. The last bar, which is the only bar this touches and the one
 *  it exists to help, went from 69% right to 55%. A tie-break that flips one
 *  clear case in eight is not breaking ties. The cause is plain once seen: in a
 *  minor scale v and VII share two of their three notes, so v can explain
 *  almost everything VII explains and then collect the bonus on top.
 *
 *  0.05 is where the sweep shows no cost (63% exact, and a point BETTER on the
 *  last bar than none at all). Not zero, because the corpus that condemns 0.2
 *  under-represents the case this is for: material folded onto a progression
 *  ends wherever that progression ends, while a melody somebody WROTE tends to
 *  cadence. Keeping a small thumb on the scale costs nothing measurable and
 *  still says something true about how phrases end. */
const DEFAULT_CADENCE = 0.05;

/** 0-based degrees, so 0 is the tonic and 4 is the fifth. The two a phrase can
 *  end on without sounding like it stopped in the middle. */
const CADENCE_DEGREES = new Set([0, 4]);

export function inferChords(notes: readonly NoteEvent[], o: InferOptions): Chord[] {
  const len = scaleIntervals(o.scale).length;
  const inertia = o.inertia ?? DEFAULT_INERTIA;
  const cadence = o.cadence ?? DEFAULT_CADENCE;
  const degrees: number[] = [];
  let prev = 0;

  for (let bar = 0; bar < o.bars; bar++) {
    const lo = bar * o.barTicks;
    const hi = lo + o.barTicks;

    // Weight per degree class, gathered once and then scored against every
    // candidate — the notes are walked once per bar, not once per candidate.
    const weight = new Map<number, number>();
    let total = 0;
    for (const nte of notes) {
      if (nte.start < lo || nte.start >= hi) continue;
      const deg = midiToScaleDegree(nte.midi, o.key, o.scale, 0);
      const pc = ((deg % len) + len) % len;
      const w = noteWeight(nte.start - lo, nte.duration, o.barTicks);
      weight.set(pc, (weight.get(pc) ?? 0) + w);
      total += w;
    }

    // An empty bar holds the previous chord. Nothing happened, so nothing
    // should change. The first bar has no previous and starts on the tonic.
    if (total === 0) { degrees.push(prev); continue; }

    const isLast = bar === o.bars - 1;
    let best = 0;
    let bestScore = -Infinity;
    for (let d = 0; d < len; d++) {
      const inside = triadClasses(d, len);
      let score = 0;
      for (const [pc, w] of weight) score += inside.has(pc) ? w : -OUTSIDE_COST * w;
      if (d === prev) score += inertia * total;
      // Only the last bar, and only because this analysis can SEE the last bar.
      // A design that reacted to what had already sounded would not have heard
      // it yet at the moment it must choose.
      if (isLast && CADENCE_DEGREES.has(d)) score += cadence * total;
      // Strictly greater, so a tie goes to the LOWER degree and the answer is
      // the same on every run — this feeds an offline render that must match
      // what was heard live.
      if (score > bestScore) { bestScore = score; best = d; }
    }
    degrees.push(best);
    prev = best;
  }

  // Consecutive bars on the same chord are ONE chord that lasts longer, which
  // is what `Chord.bars` exists to say. One entry per bar would make every
  // progression look like it changes every bar even when it does not — and the
  // chord bar would draw four cells where the music has one.
  const out: Chord[] = [];
  for (const degree of degrees) {
    const last = out[out.length - 1];
    if (last && last.degree === degree) last.bars += 1;
    else out.push({ degree, bars: 1 });
  }
  return out;
}
