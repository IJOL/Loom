// How chords are PLAYED: five rhythms, and which one each style comps with.
//
// Its own module because two features need exactly this and neither can import
// the other. `harmony.ts` uses it for the clip inspector's Chords button, and
// `harmony-shapes.ts` uses it for the material a chordal WEAVE lane draws —
// and harmony-shapes already imports harmony for `diatonicTriad`, so putting
// the table in either one makes a cycle out of two files that simply share a
// fact.
//
// Sharing it is not tidiness. The table existed here first, for the Chords
// button, and the shapes offered in WEAVE were a SECOND copy of the same five
// rhythms with no style map at all — so a pad in Deep House and a pad in Jungle
// came out identical unless the user happened to pick right by hand, while the
// answer sat two files away, written out for all twenty styles.

import type { StyleId } from './musicality';

/** One hit within a bar. Positions are 16th-note STEPS, scaled by barTicks/16
 *  at render time so a non-4/4 meter still works. */
export interface Hit { stepOffset: number; durationSteps: number; }

export type ChordShapeId =
  | 'sustained' | 'offbeat' | 'eighths' | 'sparse' | 'syncopated';

export const SHAPES: Record<ChordShapeId, Hit[]> = {
  sustained:  [{ stepOffset: 0, durationSteps: 16 }],
  offbeat:    [2, 6, 10, 14].map((s) => ({ stepOffset: s, durationSteps: 1 })),
  eighths:    [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ stepOffset: s, durationSteps: 1 })),
  sparse:     [{ stepOffset: 0, durationSteps: 2 }, { stepOffset: 8, durationSteps: 2 }],
  // Downbeat, a 16th ahead of beat 3, and the offbeat before the bar ends.
  syncopated: [
    { stepOffset: 0, durationSteps: 1 },
    { stepOffset: 9, durationSteps: 1 },
    { stepOffset: 14, durationSteps: 1 },
  ],
};

/** What a chordal lane is offered instead of loops. Five, because they are five
 *  ways of playing chords and not five settings of one. */
export const CHORD_SHAPES: { id: ChordShapeId; label: string }[] = [
  { id: 'sustained',  label: 'Sustained' },
  { id: 'offbeat',    label: 'Offbeat stabs' },
  { id: 'eighths',    label: 'Pulsing eighths' },
  { id: 'sparse',     label: 'Sparse stabs' },
  { id: 'syncopated', label: 'Syncopated' },
];

/** Which shape each style comps with. Exhaustive by type: a new style must fail
 *  to compile until somebody has decided how its chords are played, which is a
 *  musical question and not one to default. */
const STYLE_SHAPE: Record<StyleId, ChordShapeId> = {
  house:           'offbeat',
  'deep-house':    'offbeat',
  garage:          'offbeat',
  techno:          'sparse',
  'acid-techno':   'sparse',
  'dub-techno':    'offbeat',
  trance:          'eighths',
  psytrance:       'eighths',
  edm:             'eighths',
  synthwave:       'eighths',
  electro:         'sparse',
  breakbeat:       'syncopated',
  'drum-and-bass': 'syncopated',
  jungle:          'syncopated',
  dubstep:         'sparse',
  idm:             'syncopated',
  glitch:          'syncopated',
  downtempo:       'sustained',
  'lo-fi':         'sustained',
  ambient:         'sustained',
};

/** The shape this style comps with — the one a chordal lane should start on.
 *
 *  Falls back to acid-techno's rather than to the first of the five, because an
 *  unknown style is a style id from a newer build and 'sparse' is a shape that
 *  sits under almost anything; 'eighths' under a downtempo track would not. */
export function shapeForStyle(style: StyleId): ChordShapeId {
  return STYLE_SHAPE[style] ?? STYLE_SHAPE['acid-techno'];
}

/** Validated, never cast. An id that parses but does not exist is a loop that
 *  shows in the dropdown and plays silence. */
export function isChordShape(id: string): id is ChordShapeId {
  return Object.prototype.hasOwnProperty.call(SHAPES, id);
}
