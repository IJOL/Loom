// The pad shelf: the chordal loops a lane is offered, GENERATED not authored.
//
// There are no pad loops in the pattern library and there cannot be. A chord
// written as fixed semitones cannot stay diatonic across the eight scales a
// session may be in — `[0,3,7]` is a minor triad in a minor key and something
// else in a major one — and transposition by degree SNAPS to the scale before
// it moves anything, so an out-of-scale stack comes back mangled rather than
// merely transposed: `[0,4,7]` in A minor returns F–B–C, a tritone and a
// semitone. Written in DEGREES they are diatonic in every scale by
// construction, which is the only way this shelf can exist at all.
//
// A loop is a list of hits, and a hit says WHEN, HOW LONG and WHICH VOICES —
// voices as scale degrees above the root, so `[0, 2, 4]` is the triad, `[0, 2,
// 4, 6]` adds the seventh and `[0, 4]` is the bare fifth. That third field is
// the whole difference between a pad shelf and the five bare rhythms this
// started as: it is what lets a loop open out, thin down, or come in a voice at
// a time.
//
// ONE BAR each, deliberately. The blend folds two loops by position WITHIN a
// bar (see weave/blend-clip), so a two-bar loop would be folded against the
// same bar twice and the second half would never be heard. Length belongs to
// the clip, not to the material.
//
// Rendered on the TONIC. The progression moves each bar onto its own chord
// downstream (applyProgression) and the voicing is chosen after that
// (revoiceChords) — a loop that pre-applied a chord here would be moved twice.

import { scaleDegreeToMidi, type ScaleId } from './musicality';
import { SHAPES, CHORD_SHAPES, type ChordShapeId } from './chord-rhythms';
import type { NoteEvent } from './notes';

/** One chord in a loop: when it lands, how long it holds, and which voices of
 *  the chord sound. Degrees are steps of the SCALE above the root, so the same
 *  numbers are a minor chord in a minor key and a major one in a major key. */
export interface PadHit {
  stepOffset: number;
  durationSteps: number;
  /** Absent ⇒ the plain triad. */
  degrees?: number[];
}

export interface PadLoop {
  id: string;
  label: string;
  hits: PadHit[];
}

const TRIAD = [0, 2, 4];
const SEVENTH = [0, 2, 4, 6];
const NINTH = [0, 2, 4, 8];
const SUS2 = [0, 1, 4];
const FIFTH = [0, 4];

const hold = (degrees: number[]): PadHit[] => [{ stepOffset: 0, durationSteps: 16, degrees }];

/** Held chords and moving ones, in the order a shelf reads best: the ones that
 *  sit still first, then the ones that move.
 *
 *  The five that came before this shelf existed — Sustained, Offbeat, Eighths,
 *  Sparse, Syncopated — are BUILT from `chord-rhythms.ts` rather than repeated
 *  here, because the clip inspector's Chords button comps with the same five
 *  and two copies of a rhythm is how a style ends up meaning one thing in one
 *  screen and another thing in the next. Their ids are unchanged: a session
 *  saved on one of them still resolves. */
const RICH: PadLoop[] = [
  { id: 'seventh', label: 'Deep 7th', hits: hold(SEVENTH) },
  { id: 'ninth', label: 'Open 9th', hits: hold(NINTH) },
  { id: 'sus', label: 'Sus Air', hits: hold(SUS2) },
  { id: 'fifths', label: 'Hollow Fifths', hits: hold(FIFTH) },

  // Comes in a voice at a time and holds to the end of the bar: the swell every
  // pad shelf has, and something no rhythm-only shape could express.
  {
    id: 'rise',
    label: 'Rise',
    hits: [
      { stepOffset: 0, durationSteps: 16, degrees: [0] },
      { stepOffset: 4, durationSteps: 12, degrees: [2] },
      { stepOffset: 8, durationSteps: 8, degrees: [4] },
      { stepOffset: 12, durationSteps: 4, degrees: [6] },
    ],
  },
  // The opposite gesture: full chord, then voices drop away.
  {
    id: 'fall',
    label: 'Fall',
    hits: [
      { stepOffset: 0, durationSteps: 16, degrees: [0] },
      { stepOffset: 0, durationSteps: 12, degrees: [2] },
      { stepOffset: 0, durationSteps: 8, degrees: [4] },
      { stepOffset: 0, durationSteps: 4, degrees: [6] },
    ],
  },
  // Two halves that are not the same chord: triad, then the seventh opens it.
  {
    id: 'swell',
    label: 'Half Swell',
    hits: [
      { stepOffset: 0, durationSteps: 8, degrees: TRIAD },
      { stepOffset: 8, durationSteps: 8, degrees: SEVENTH },
    ],
  },
  // A held bed with the upper voices breathing over it — the bread and butter
  // of a deep house pad, and unreachable with one voice set per loop.
  {
    id: 'breathe',
    label: 'Breathing',
    hits: [
      { stepOffset: 0, durationSteps: 16, degrees: FIFTH },
      { stepOffset: 2, durationSteps: 2, degrees: [2, 6] },
      { stepOffset: 8, durationSteps: 2, degrees: [2, 6] },
      { stepOffset: 12, durationSteps: 3, degrees: [2, 8] },
    ],
  },
  // Sevenths on the offbeat: the same push as Offbeat stabs, with a chord that
  // has somewhere to go.
  {
    id: 'push',
    label: 'Offbeat 7ths',
    hits: [2, 6, 10, 14].map((s) => ({ stepOffset: s, durationSteps: 2, degrees: SEVENTH })),
  },
];

/** Every pad loop on the shelf: the five rhythms first, then the rest. */
export const PAD_LOOPS: PadLoop[] = [
  ...CHORD_SHAPES.map((s) => ({
    id: s.id as string,
    label: s.label,
    hits: SHAPES[s.id as ChordShapeId] as PadHit[],
  })),
  ...RICH,
];

const BY_ID = new Map(PAD_LOOPS.map((p) => [p.id, p]));

/** Validated, never cast. An id that parses but does not exist is a loop that
 *  shows in the dropdown and plays silence. */
export function isPadLoop(id: string): boolean {
  return BY_ID.has(id);
}

export function padLoop(id: string): PadLoop | undefined {
  return BY_ID.get(id);
}

/** One bar of a pad loop, on the tonic.
 *
 *  `octaveBase` is the RAW base — 48, not 48-moved-to-the-key. The key is added
 *  by `scaleDegreeToMidi`, so a base that already carried it applies it twice. */
export function renderPadLoop(
  id: string,
  opts: { key: number; scale: ScaleId; octaveBase: number; barTicks: number },
): NoteEvent[] {
  const loop = BY_ID.get(id);
  if (!loop) return [];
  const { key, scale, octaveBase, barTicks } = opts;
  const stepTicks = barTicks / 16;
  const out: NoteEvent[] = [];
  let first = true;
  for (const hit of loop.hits) {
    const start = hit.stepOffset * stepTicks;
    if (start >= barTicks) continue;
    const duration = Math.min(hit.durationSteps * stepTicks, barTicks - start);
    // The downbeat louder, the way the comping generator already accents it.
    const velocity = first ? 115 : 95;
    first = false;
    for (const d of hit.degrees ?? TRIAD) {
      out.push({ start, duration, midi: scaleDegreeToMidi(d, octaveBase, key, scale), velocity });
    }
  }
  return out;
}
