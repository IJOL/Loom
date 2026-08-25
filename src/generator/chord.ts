// CHORD: which note the step lands on.
//
// The material already gives a line — the pool, read at the head. This is what
// makes that line agree with the harmony the song is in, and then what lets it
// be moved through the chord without leaving it.
//
// Two settings, and neither is "better" — the same choice `notefx/chord` offers
// and for the same reason (piece 2b). SCALE keeps you in the key and still lets
// a passing note through that the chord does not contain; CHORD locks you to
// three pitch classes and cannot sound wrong against the harmony, nor can it
// sound like a melody. Which you want depends on whether the lane is stating
// the harmony or moving over it.
//
// The vocabulary is 2b's, unchanged: `chordTonesOf` derives a degree's tones by
// stacking thirds over the scale's OWN length, so a pentatonic wraps at five
// rather than seven, and `snapToPitchClasses` resolves ties upward the way
// `snapToScale` does. Repeating either here would be a second answer to a
// question that already has one.
//
// Pure: no session, no clock. The bar arrives as a number and the progression
// as data.

import {
  chordTonesOf, degreesOf, snapToPitchClasses, type ScaleId,
} from '../core/musicality';
import { chordAtBar, type Progression } from '../arranger/progression';
import { patternValue, GOLDEN_PATTERN } from '../audio-dsp/pattern';
import { clamp01 } from '../audio-dsp/dsp-util';

/** Off, in the key, or on the chord. */
export type ConformMode = 'off' | 'scale' | 'chord';

export interface ChordSpec {
  conform: ConformMode;
  /** How far up or down the set the note moves, in TONES of that set — chord
   *  tones on 'chord', scale degrees on 'scale'. Not semitones: a step that
   *  meant a semitone would be a transposition, and transposing a lane is the
   *  weave's octave fold, a different control for a different job. */
  pitch: number;
  pattern: number;
  /** 0..1 — how far the per-step formula moves `pitch`. */
  mod: number;
}

/** Full depth spans an octave either way. Three tones IS an octave for a triad,
 *  which is what makes it the honest maximum rather than a taste. */
const MAX_SPREAD = 3;

const MAX_PITCH = 7;

/** OFF, and deliberately so. The material arrives already in key — the blend
 *  walks scale DEGREES, so every pitch the pool holds is in the session's scale
 *  — which makes scale-conform a no-op at the default with a cost. Chord-conform
 *  is a musical choice, not a better setting. */
export const DEFAULT_CHORD: ChordSpec = {
  conform: 'off', pitch: 0, pattern: GOLDEN_PATTERN, mod: 0,
};

export function clampChord(c: Partial<ChordSpec> | null | undefined): ChordSpec {
  if (!c) return { ...DEFAULT_CHORD };
  const num = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
  return {
    conform: c.conform === 'scale' || c.conform === 'chord' ? c.conform : 'off',
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.round(num(c.pitch, 0)))),
    pattern: num(c.pattern, DEFAULT_CHORD.pattern),
    mod: clamp01(num(c.mod, 0)),
  };
}

/** The next midi above or below `midi` whose pitch class is in the set.
 *
 *  Twelve semitones is the whole search: any non-empty pitch-class set has a
 *  member within an octave by construction, so the fallback is unreachable and
 *  exists only so the loop has an exit a reader can see. */
function nextTone(midi: number, pcs: readonly number[], dir: 1 | -1): number {
  for (let d = 1; d <= 12; d++) {
    const c = midi + dir * d;
    if (pcs.includes(((c % 12) + 12) % 12)) return c;
  }
  return midi + dir * 12;
}

/** Move `midi` `n` tones through a pitch-class set, up or down. */
export function stepTones(midi: number, pcs: readonly number[], n: number): number {
  if (pcs.length === 0 || n === 0 || !Number.isFinite(n)) return midi;
  const dir = n > 0 ? 1 : -1;
  let out = midi;
  for (let i = 0; i < Math.abs(Math.round(n)); i++) out = nextTone(out, pcs, dir);
  return out;
}

/** The pitch classes this step is allowed to land on, or empty for 'off'. */
export function toneSetAt(
  spec: ChordSpec, tonality: { key: number; scale: ScaleId }, prog: Progression, bar: number,
): number[] {
  if (spec.conform === 'off') return [];
  if (spec.conform === 'scale') return degreesOf(tonality.key, tonality.scale);
  // The progression is the SONG's, promoted out of the weave in 2c. With none
  // to ask, the key's own tonic triad is the honest answer: degree 0 is what
  // "in this key" means when nothing has said otherwise.
  const degree = chordAtBar(prog, bar)?.degree ?? 0;
  return chordTonesOf(tonality.key, tonality.scale, degree);
}

export interface ChordAt {
  /** The step's position on the pattern, for the per-step formula. The same
   *  number CADENCE reads, so the two streams evolve together. */
  head: number;
  /** Which bar of the SONG this is. Deliberately not the head's bar: the rhythm
   *  repeats with the pattern and the harmony walks the song, so every lane
   *  agrees on where the music is while disagreeing about what to play there. */
  bar: number;
}

/** The note this step lands on. Returns `midi` untouched when conform is off. */
export function chordPitch(
  midi: number,
  spec: ChordSpec,
  tonality: { key: number; scale: ScaleId },
  prog: Progression,
  at: ChordAt,
): number {
  const pcs = toneSetAt(spec, tonality, prog, at.bar);
  // Off means off, in both halves. A stream where the conform is inert and the
  // voicing offset still moves would be half a control working, which reads as
  // a bug in whichever half the user notices second.
  if (pcs.length === 0) return midi;

  const swing = (patternValue(at.head, spec.pattern) - 0.5) * 2 * spec.mod * MAX_SPREAD;
  return stepTones(snapToPitchClasses(midi, pcs), pcs, spec.pitch + swing);
}
