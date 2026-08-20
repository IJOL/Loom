// How chords are PLAYED: a vocabulary of rhythms, and which ones each style
// comps with.
//
// Its own module because two features need exactly this and neither can import
// the other. `harmony.ts` uses it for the clip inspector's Chords button, and
// `pad-loops.ts` uses it for the material a chordal WEAVE lane draws — and
// pad-loops already imports harmony's neighbours, so putting the table in
// either one makes a cycle out of two files that simply share a fact.
//
// Sharing it is not tidiness. The table existed here first, for the Chords
// button, and the shapes offered in WEAVE were a SECOND copy of the same
// rhythms with no style map at all — so a pad in Deep House and a pad in Jungle
// came out identical unless the user happened to pick right by hand, while the
// answer sat two files away, written out for all twenty styles.
//
// A style names a PALETTE, not a rhythm. One rhythm per style is what made a
// derived accompaniment a drone with a metronome attached: the harmony could
// not move (every library loop infers the tonic) and the rhythm was a table
// lookup on a style that does not move either, so the part was a constant
// function of a constant. Reported, correctly, as "el comp no ha cambiado en
// ningún momento ni el bajo". Four ways of comping a style is what a player
// has; one is what a preset has.

import type { StyleId } from './musicality';

/** One hit within a bar. Positions are 16th-note STEPS, scaled by barTicks/16
 *  at render time so a non-4/4 meter still works. */
export interface Hit { stepOffset: number; durationSteps: number; }

export type ChordShapeId =
  // The five this started as. Their ids are saved in sessions (`chord:<id>`),
  // so they keep both their names and their contents exactly.
  | 'sustained' | 'offbeat' | 'eighths' | 'sparse' | 'syncopated'
  // The vocabulary that turns a style's single rhythm into a palette.
  | 'quarters' | 'halves' | 'charleston' | 'backbeat' | 'pushes'
  | 'sixteenths' | 'gallop' | 'dotted' | 'clave' | 'tresillo'
  | 'stabHold' | 'longPush' | 'swellEnd';

const every = (steps: number[], durationSteps = 1): Hit[] =>
  steps.map((stepOffset) => ({ stepOffset, durationSteps }));

export const SHAPES: Record<ChordShapeId, Hit[]> = {
  sustained:  [{ stepOffset: 0, durationSteps: 16 }],
  offbeat:    every([2, 6, 10, 14]),
  eighths:    every([0, 2, 4, 6, 8, 10, 12, 14]),
  sparse:     [{ stepOffset: 0, durationSteps: 2 }, { stepOffset: 8, durationSteps: 2 }],
  // Downbeat, a 16th ahead of beat 3, and the offbeat before the bar ends.
  syncopated: [
    { stepOffset: 0, durationSteps: 1 },
    { stepOffset: 9, durationSteps: 1 },
    { stepOffset: 14, durationSteps: 1 },
  ],

  /** On every beat. The plainest thing a comp can do and the one that never
   *  fights the kick, which is why almost every four-to-the-floor style has it
   *  in its palette even when it is not that style's signature. */
  quarters:   every([0, 4, 8, 12]),
  /** Two long chords. Half a bar each — the bed that is not a drone, because it
   *  still restates the harmony at the halfway point. */
  halves:     [{ stepOffset: 0, durationSteps: 8 }, { stepOffset: 8, durationSteps: 8 }],
  /** The Charleston: downbeat and the "and of two". The oldest comping figure
   *  there is and the reason a house track sounds like it swings. */
  charleston: [{ stepOffset: 0, durationSteps: 2 }, { stepOffset: 6, durationSteps: 2 }],
  /** On two and four. Chops against the backbeat rather than with the kick. */
  backbeat:   [{ stepOffset: 4, durationSteps: 2 }, { stepOffset: 12, durationSteps: 2 }],
  /** A 16th ahead of every beat. Nothing lands ON a beat, so the whole bar
   *  leans forward — the most forward-driving shape here. */
  pushes:     every([3, 7, 11, 15]),
  /** Every 16th. Relentless on purpose; the phrase shaping is what keeps it
   *  from being unlistenable over four bars. */
  sixteenths: every([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
  /** Two 16ths into each half-bar, then the beat. The stutter figure. */
  gallop:     every([0, 3, 4, 8, 11, 12]),
  /** Dotted eighths: a five-against-four cycle that drifts against the bar and
   *  resolves at the bar line. */
  dotted:     every([0, 3, 6, 9, 12]),
  /** Son clave, near enough: the 3-2 side of it, which is the pattern every
   *  broken-beat style is a descendant of. */
  clave:      every([0, 3, 6, 10, 12]),
  /** Tresillo — 3+3+2, twice. Half of clave and twice as common. */
  tresillo:   every([0, 3, 6, 8, 11, 14]),
  /** Two stabs and then a hold. A figure with a shape to it rather than a
   *  grid: it says something and then gets out of the way. */
  stabHold:   [
    { stepOffset: 0, durationSteps: 1 },
    { stepOffset: 4, durationSteps: 1 },
    { stepOffset: 8, durationSteps: 6 },
  ],
  /** A long chord, then the second half arrives early and holds over. The lean
   *  built into the shape rather than applied to it. */
  longPush:   [{ stepOffset: 0, durationSteps: 6 }, { stepOffset: 7, durationSteps: 9 }],
  /** Held nearly the whole bar, re-struck at the end. What a player does on
   *  the bar before the phrase turns round. */
  swellEnd:   [{ stepOffset: 0, durationSteps: 12 }, { stepOffset: 14, durationSteps: 2 }],
};

/** What a chordal lane is offered instead of loops, in the order a shelf reads
 *  best: the ones that sit still first, then the ones that move. */
export const CHORD_SHAPES: { id: ChordShapeId; label: string }[] = [
  { id: 'sustained',  label: 'Sustained' },
  { id: 'halves',     label: 'Half Chords' },
  { id: 'sparse',     label: 'Sparse stabs' },
  { id: 'quarters',   label: 'On the beat' },
  { id: 'backbeat',   label: 'Two and Four' },
  { id: 'charleston', label: 'Charleston' },
  { id: 'offbeat',    label: 'Offbeat stabs' },
  { id: 'eighths',    label: 'Pulsing eighths' },
  { id: 'sixteenths', label: 'Driving 16ths' },
  { id: 'pushes',     label: 'Pushed' },
  { id: 'syncopated', label: 'Syncopated' },
  { id: 'tresillo',   label: 'Tresillo' },
  { id: 'clave',      label: 'Clave' },
  { id: 'dotted',     label: 'Dotted' },
  { id: 'gallop',     label: 'Gallop' },
  { id: 'stabHold',   label: 'Stab and Hold' },
  { id: 'longPush',   label: 'Long Push' },
  { id: 'swellEnd',   label: 'Swell and Turn' },
];

/** How each style comps, in order of how typical it is.
 *
 *  Exhaustive by type: a new style must fail to compile until somebody has
 *  decided how its chords are played, which is a musical question and not one
 *  to default.
 *
 *  The FIRST entry of every palette is the shape that style used when there was
 *  only one, so nothing a session already sounds like changes — what changes is
 *  that there is somewhere for it to go next. */
const STYLE_PALETTE: Record<StyleId, ChordShapeId[]> = {
  house:           ['offbeat', 'charleston', 'quarters', 'pushes'],
  'deep-house':    ['offbeat', 'charleston', 'halves', 'stabHold'],
  garage:          ['offbeat', 'tresillo', 'pushes', 'clave'],
  techno:          ['sparse', 'quarters', 'stabHold', 'longPush'],
  'acid-techno':   ['sparse', 'quarters', 'pushes', 'gallop'],
  'dub-techno':    ['offbeat', 'halves', 'sparse', 'swellEnd'],
  trance:          ['eighths', 'sixteenths', 'quarters', 'pushes'],
  psytrance:       ['eighths', 'sixteenths', 'gallop', 'dotted'],
  edm:             ['eighths', 'quarters', 'pushes', 'sixteenths'],
  synthwave:       ['eighths', 'quarters', 'halves', 'charleston'],
  electro:         ['sparse', 'gallop', 'backbeat', 'clave'],
  breakbeat:       ['syncopated', 'clave', 'tresillo', 'backbeat'],
  'drum-and-bass': ['syncopated', 'tresillo', 'dotted', 'stabHold'],
  jungle:          ['syncopated', 'clave', 'tresillo', 'gallop'],
  dubstep:         ['sparse', 'halves', 'longPush', 'backbeat'],
  idm:             ['syncopated', 'dotted', 'gallop', 'clave'],
  glitch:          ['syncopated', 'sixteenths', 'dotted', 'tresillo'],
  downtempo:       ['sustained', 'halves', 'swellEnd', 'sparse'],
  'lo-fi':         ['sustained', 'halves', 'charleston', 'sparse'],
  ambient:         ['sustained', 'halves', 'swellEnd', 'longPush'],
};

/** Every way this style comps, most typical first.
 *
 *  Falls back to acid-techno's rather than to the first of the vocabulary,
 *  because an unknown style is a style id from a newer build and 'sparse' sits
 *  under almost anything; 'sixteenths' under a downtempo track would not. */
export function shapesForStyle(style: StyleId): ChordShapeId[] {
  return STYLE_PALETTE[style] ?? STYLE_PALETTE['acid-techno'];
}

/** The shape this style comps with — the one a chordal lane should start on,
 *  and what the Chords button writes. The head of the palette. */
export function shapeForStyle(style: StyleId): ChordShapeId {
  return shapesForStyle(style)[0];
}

/** The shape this style comps with on its Nth turn.
 *
 *  Taken modulo rather than clamped, so a caller counting phrases forever walks
 *  the palette round and round. A negative or non-finite `variant` answers the
 *  head — the caller that does not know where it is gets the typical one, which
 *  is exactly what it got before this existed. */
export function shapeForStyleVariant(style: StyleId, variant: number): ChordShapeId {
  const palette = shapesForStyle(style);
  if (!Number.isFinite(variant)) return palette[0];
  const n = palette.length;
  return palette[((Math.floor(variant) % n) + n) % n];
}

/** Validated, never cast. An id that parses but does not exist is a loop that
 *  shows in the dropdown and plays silence. */
export function isChordShape(id: string): id is ChordShapeId {
  return Object.prototype.hasOwnProperty.call(SHAPES, id);
}
