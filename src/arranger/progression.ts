// A chord progression, and what it does to material that was written over one
// chord.
//
// This is the piece Loom has never had. A session picks a key and a scale once
// and stays there for ever: loops change, sounds change, the mix moves, and the
// harmony never does. That is why a scene can be busy for two minutes and still
// feel like it is standing still — nothing is ever leaving home, so nothing
// ever comes back.
//
// A progression is stored as SCALE DEGREES, never as notes. Degrees survive a
// change of key and of mode: i-VI-III-VII is the same progression in A minor
// and in F dorian, and storing "A, F, C, G" would tie it to one key and make
// transposing a rewrite. It is also what lets the same catalogue serve material
// the user imported in a key nobody chose.
//
// What it does to a loop is DIATONIC transposition: every note is moved by a
// number of scale steps, not semitones. Moving a minor line up four semitones
// lands it outside the scale on half its notes; moving it up two DEGREES keeps
// every note in the key, and is what a player does without thinking.
//
// Pure: notes in, notes out. No session, no clock, no DOM.

import { midiToScaleDegree, scaleDegreeToMidi, type ScaleId } from '../core/musicality';
import type { NoteEvent } from '../core/notes';

/** One chord: a scale degree and how long it lasts.
 *
 *  `degree` is 0-based — 0 is the tonic, 5 is the sixth degree — because that
 *  is what the degree maths in core/musicality speaks. Roman numerals are a
 *  display concern and belong in whatever draws this.
 *
 *  `bars` rather than ticks: a progression is a musical structure, and tying it
 *  to a tick count would tie it to a meter it should survive. */
export interface Chord {
  degree: number;
  bars: number;
}

export type Progression = readonly Chord[];

export interface ProgressionEntry {
  id: string;
  name: string;
  /** What it does to the ear, in the user's words rather than a theorist's. */
  feel: string;
  chords: Progression;
}

const four = (...degrees: number[]): Progression => degrees.map((degree) => ({ degree, bars: 1 }));

/** The catalogue.
 *
 *  Small on purpose, and every entry earns its place by being a progression
 *  people actually play rather than one that completes a table. They are
 *  written in DEGREES, so each one works in any key and any mode — what
 *  changes is the colour the mode gives it, not the shape.
 *
 *  Degrees only, no chord QUALITY: the scale already decides whether the third
 *  above a degree is major or minor, so storing "minor sixth" would be storing
 *  something the key can contradict. */
export const PROGRESSIONS: readonly ProgressionEntry[] = [
  {
    id: 'static',
    name: 'Stay home',
    feel: 'Never leaves. What Loom did before this existed, kept so it is a choice.',
    chords: [{ degree: 0, bars: 1 }],
  },
  {
    id: 'i-VI',
    name: 'Two chords',
    feel: 'Leans away and comes back. The smallest thing that stops sounding static.',
    chords: [{ degree: 0, bars: 2 }, { degree: 5, bars: 2 }],
  },
  {
    id: 'i-VI-III-VII',
    name: 'The long fall',
    feel: 'Keeps descending. House and trance live here.',
    chords: four(0, 5, 2, 6),
  },
  {
    id: 'i-VII-VI-VII',
    name: 'Rocking',
    feel: 'Goes down and comes half way back. Restless without going anywhere new.',
    chords: four(0, 6, 5, 6),
  },
  {
    id: 'i-iv-v',
    name: 'The plain one',
    feel: 'Tension and release, the oldest shape there is.',
    chords: [{ degree: 0, bars: 2 }, { degree: 3, bars: 1 }, { degree: 4, bars: 1 }],
  },
  {
    id: 'i-III-VII-iv',
    name: 'Wandering',
    feel: 'Never quite settles. Good under something that repeats.',
    chords: four(0, 2, 6, 3),
  },
];

export const progressionById = (id: string): ProgressionEntry | undefined =>
  PROGRESSIONS.find((p) => p.id === id);

/** How many bars one lap of a progression takes. Zero for an empty one, which
 *  callers read as "no progression" rather than dividing by it. */
export function progressionBars(prog: Progression): number {
  return prog.reduce((n, c) => n + Math.max(0, c.bars), 0);
}

/** Which chord is sounding in `bar`, counting from the start and repeating for
 *  ever. Null when there is no progression to ask. */
export function chordAtBar(prog: Progression, bar: number): Chord | null {
  const total = progressionBars(prog);
  if (total <= 0) return null;
  let at = ((bar % total) + total) % total;
  for (const c of prog) {
    const len = Math.max(0, c.bars);
    if (at < len) return c;
    at -= len;
  }
  return prog[prog.length - 1] ?? null;
}

/** Move one note by `steps` SCALE degrees, staying in the key.
 *
 *  Degrees rather than semitones, because a fixed semitone shift walks material
 *  out of the scale: up four semitones from a minor third lands on a note the
 *  key does not contain, on half the notes and not the other half. Going by
 *  degrees is both in tune by construction and what a player's hand does.
 *
 *  `octaveBase` is 0 — a real multiple of twelve, so the round trip through
 *  degrees is exact. Any other value puts the scale root between the scale's
 *  own intervals and the conversion stops being reversible, which is a fault
 *  this codebase has already shipped once. */
export function transposeByDegrees(
  midi: number, steps: number, key: number, scale: ScaleId,
): number {
  if (steps === 0) return midi;
  const degree = midiToScaleDegree(midi, key, scale, 0);
  return scaleDegreeToMidi(degree + steps, 0, key, scale);
}

/** Lay a progression over material written on one chord.
 *
 *  Each note moves by the degree of whichever chord its bar is under, so a loop
 *  keeps its rhythm and its shape and changes what it is sitting on. That is
 *  the arranger move: the pattern is the player's right hand and the
 *  progression is the left.
 *
 *  Percussion must never come through here — a drum note picks a voice, not a
 *  pitch, and transposing it changes the instrument. The caller decides, since
 *  only it can ask the capability door. */
export function applyProgression(
  notes: readonly NoteEvent[],
  prog: Progression,
  barTicks: number,
  key: number,
  scale: ScaleId,
): NoteEvent[] {
  if (barTicks <= 0 || progressionBars(prog) <= 0) return [...notes];
  return notes.map((n) => {
    const chord = chordAtBar(prog, Math.floor(n.start / barTicks));
    if (!chord || chord.degree === 0) return n;
    return { ...n, midi: transposeByDegrees(n.midi, chord.degree, key, scale) };
  });
}
