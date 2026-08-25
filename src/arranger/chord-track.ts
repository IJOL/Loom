// Editing a progression by hand.
//
// The catalogue stopped being the only input, and these are the four things a
// person does to a written one. Pure and non-mutating: the weave state is read
// while the panel repaints, so an in-place edit would change what a reader is
// halfway through.
//
// Every op takes an index and returns a NEW track. An index that is not there
// returns the track unchanged rather than growing a hole — a panel repaints
// from state it may have drawn a moment ago, and a stale click must be inert
// rather than destructive.

import { progressionById, chordAtBar, type Chord, type Progression } from './progression';
import { stepsPerBar, type TimeSignature } from '../core/meter';

const copy = (t: Progression): Chord[] => t.map((c) => ({ ...c }));
const has = (t: Progression, i: number) => Number.isInteger(i) && i >= 0 && i < t.length;

/** Point one slot at another scale degree. */
export function setDegree(track: Progression, i: number, degree: number): Chord[] {
  if (!has(track, i)) return copy(track);
  const out = copy(track);
  out[i].degree = degree;
  return out;
}

/** How many bars a slot lasts. At least one, and whole: a zero-bar chord never
 *  sounds and `progressionBars` counts it as nothing, so a lap would silently
 *  skip that slot. Rounded because the gesture is a drag. */
export function setLength(track: Progression, i: number, bars: number): Chord[] {
  if (!has(track, i)) return copy(track);
  const out = copy(track);
  out[i].bars = Math.max(1, Math.round(bars));
  return out;
}

/** Add a slot after `i`, copying it — a new cell that starts on the chord
 *  beside it is somewhere to edit FROM, where one that started on the tonic
 *  would be a decision the user did not make. */
export function insertAfter(track: Progression, i: number): Chord[] {
  if (!has(track, i)) return copy(track);
  const out = copy(track);
  out.splice(i + 1, 0, { ...out[i] });
  return out;
}

/** Remove a slot, but never the last one: an empty track means "no
 *  progression", and the editor would be left with nothing in it and no way
 *  back. */
export function removeAt(track: Progression, i: number): Chord[] {
  if (!has(track, i) || track.length <= 1) return copy(track);
  const out = copy(track);
  out.splice(i, 1);
  return out;
}

/** The progression actually playing: what the user WROTE if they wrote one,
 *  else the catalogue entry they picked.
 *
 *  One accessor rather than the precedence spelled out at each reader. There
 *  are two today — the fold and the panel's chord bar — and two copies of "the
 *  written one wins" is two places to forget it, which shows up as the panel
 *  naming one chord while the music plays another.
 *
 *  An EMPTY written track means "nothing written", not "silence": the editor
 *  cannot reach zero slots by design, so an empty one is a corrupt save rather
 *  than an instruction to stop the harmony. */
export function activeProgression(
  state: { progression?: string; chords?: Progression },
): Progression {
  if (state.chords && state.chords.length > 0) return state.chords;
  return progressionById(state.progression ?? 'static')?.chords
    ?? progressionById('static')!.chords;
}

/** Which chord is sounding at an absolute transport time, as a scale degree.
 *
 *  Undefined before the transport has ever run and when the song names no
 *  progression at all. Callers must have an answer for undefined rather than
 *  a default degree: a wrong chord is worse than no chord.
 *
 *  Takes a TIME rather than reading a clock, because the caller that needs it
 *  most is asking about a note that has been SCHEDULED — the look-ahead runs
 *  ahead of the transport, so "now" answers for the wrong bar exactly at a
 *  chord change, which is the one place a listener would hear it.
 *
 *  The bar arithmetic is the position readout's, deliberately: a step is a
 *  16th at 60/bpm/4, and two different derivations of "which bar" is how two
 *  displays end up a bar apart. */
export function chordDegreeAtTime(
  tonality: { progression?: string; chords?: Progression },
  at: { time: number; startedAtSec: number | null; bpm: number; meter: TimeSignature },
): number | undefined {
  if (at.startedAtSec === null || !(at.bpm > 0)) return undefined;
  const prog = activeProgression(tonality);
  if (prog.length === 0) return undefined;
  const barSec = stepsPerBar(at.meter) * 60 / at.bpm / 4;
  if (!(barSec > 0)) return undefined;
  const bar = Math.floor(Math.max(0, at.time - at.startedAtSec) / barSec);
  return chordAtBar(prog, bar)?.degree;
}
