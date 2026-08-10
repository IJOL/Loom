// The piece Loom has never had: harmony that MOVES.
//
// A session picks a key once and stays there for ever, which is why a scene can
// be busy for two minutes and still feel like it is standing still. These tests
// pin the two properties that make a progression usable rather than merely
// present: it survives a change of key, and it never puts a note outside the
// scale.
import { describe, it, expect } from 'vitest';
import {
  PROGRESSIONS, progressionById, progressionBars, chordAtBar,
  transposeByDegrees, applyProgression,
} from './progression';
import { inScale } from '../core/musicality';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';

const BAR = TICKS_PER_QUARTER * 4;
const n = (bar: number, midi: number): NoteEvent =>
  ({ start: bar * BAR, duration: TICKS_PER_QUARTER, midi, velocity: 90 });

describe('the catalogue', () => {
  it('offers staying put as a real choice, not an absence', () => {
    // What Loom did before this existed. Keeping it in the list makes it
    // something the user picked rather than something nobody implemented.
    const stay = progressionById('static');
    expect(stay).toBeDefined();
    expect(progressionBars(stay!.chords)).toBe(1);
  });

  it('stores DEGREES, never notes', () => {
    // The property that lets one catalogue serve every key and every mode. A
    // progression written as "A, F, C, G" would be one key's progression.
    for (const p of PROGRESSIONS) {
      for (const c of p.chords) {
        expect(Number.isInteger(c.degree)).toBe(true);
        expect(c.degree).toBeGreaterThanOrEqual(0);
        expect(c.degree).toBeLessThan(7);
      }
    }
  });

  it('gives every entry a whole number of bars', () => {
    for (const p of PROGRESSIONS) expect(progressionBars(p.chords)).toBeGreaterThan(0);
  });
});

describe('chordAtBar', () => {
  const prog = [{ degree: 0, bars: 2 }, { degree: 5, bars: 1 }];

  it('walks the chords in order', () => {
    expect(chordAtBar(prog, 0)!.degree).toBe(0);
    expect(chordAtBar(prog, 1)!.degree).toBe(0);
    expect(chordAtBar(prog, 2)!.degree).toBe(5);
  });

  it('goes round for ever', () => {
    expect(chordAtBar(prog, 3)!.degree).toBe(0);
    expect(chordAtBar(prog, 5)!.degree).toBe(5);
    expect(chordAtBar(prog, 300)!.degree).toBe(0);
  });

  it('answers nothing for an empty progression rather than guessing', () => {
    expect(chordAtBar([], 0)).toBeNull();
  });
});

describe('transposeByDegrees', () => {
  it('moves by SCALE steps, so the result is always in the key', () => {
    // The whole reason this is not a semitone shift. Every note of A minor,
    // moved by every degree, has to stay in A minor.
    for (const midi of [45, 47, 48, 50, 52, 53, 55]) {
      for (let steps = 0; steps < 7; steps++) {
        expect(inScale(transposeByDegrees(midi, steps, 9, 'minor'), 9, 'minor')).toBe(true);
      }
    }
  });

  it('is the identity at zero — the tonic chord changes nothing', () => {
    expect(transposeByDegrees(45, 0, 9, 'minor')).toBe(45);
  });

  it('goes UP for a positive step and stays up', () => {
    expect(transposeByDegrees(45, 2, 9, 'minor')).toBeGreaterThan(45);
    expect(transposeByDegrees(45, 5, 9, 'minor')).toBeGreaterThan(transposeByDegrees(45, 2, 9, 'minor'));
  });

  it('lands a whole octave up after seven degrees', () => {
    expect(transposeByDegrees(45, 7, 9, 'minor')).toBe(57);
  });
});

describe('applyProgression', () => {
  const prog = [{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }];
  const KEY = 9, SCALE = 'minor' as const;

  it('leaves the first bar exactly as written', () => {
    // The tonic chord is where the material already was. A progression that
    // moved bar one would be transposing the whole loop for nothing.
    const out = applyProgression([n(0, 45), n(0, 48)], prog, BAR, KEY, SCALE);
    expect(out.map((x) => x.midi)).toEqual([45, 48]);
  });

  it('moves the next bar onto its own chord', () => {
    const out = applyProgression([n(1, 45)], prog, BAR, KEY, SCALE);
    expect(out[0].midi).not.toBe(45);
    expect(inScale(out[0].midi, KEY, SCALE)).toBe(true);
  });

  it('keeps the RHYTHM untouched — a chord change is not an edit', () => {
    const notes = [n(0, 45), n(1, 48), n(1, 52)];
    const out = applyProgression(notes, prog, BAR, KEY, SCALE);
    expect(out.map((x) => x.start)).toEqual(notes.map((x) => x.start));
    expect(out.map((x) => x.duration)).toEqual(notes.map((x) => x.duration));
    expect(out).toHaveLength(notes.length);
  });

  it('holds the SHAPE of a chord while it moves it', () => {
    // Two notes a third apart stay a third apart in scale steps: the harmony
    // moves, the voicing does not collapse.
    const out = applyProgression([n(1, 45), n(1, 48)], prog, BAR, KEY, SCALE);
    expect(out[1].midi).toBeGreaterThan(out[0].midi);
  });

  it('is the identity for the static progression', () => {
    const notes = [n(0, 45), n(1, 48), n(7, 52)];
    const out = applyProgression(notes, progressionById('static')!.chords, BAR, KEY, SCALE);
    expect(out.map((x) => x.midi)).toEqual(notes.map((x) => x.midi));
  });

  it('works the same in any key — that is what degrees are for', () => {
    // The same music in two keys must be moved by the same INTERVALS. Written
    // as notes rather than degrees, a catalogue could only ever serve one key.
    const shape = (key: number, tonicMidi: number) => {
      const out = applyProgression([n(0, tonicMidi), n(1, tonicMidi)], prog, BAR, key, SCALE);
      return out[1].midi - out[0].midi;
    };
    expect(shape(9, 45)).toBe(shape(0, 48));
  });

  it('refuses a bar of no length rather than dividing by it', () => {
    const notes = [n(0, 45)];
    expect(applyProgression(notes, prog, 0, KEY, SCALE)).toEqual(notes);
  });
});
