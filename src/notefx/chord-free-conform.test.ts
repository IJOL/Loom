// Free intervals and IN KEY on the chord note-FX. Karst builds its chord machine
// as a base plus three intervals rather than a chord NAME, and conforms every
// resulting note to the key inside each oscillator. We cannot conform down
// there — the worklet has no tonality — so it happens here, where the context
// already carries key and scale.
import { describe, it, expect } from 'vitest';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS, type ChordProcessorParams } from './chord-processor';
import type { NoteFxContext, NoteFxEvent } from './notefx-types';

const C_MAJOR: NoteFxContext = { bpm: 120, key: 0, scale: 'major' };
const NO_KEY: NoteFxContext = { bpm: 120 };

const play = (p: Partial<ChordProcessorParams>, note: number, ctx: NoteFxContext = C_MAJOR) => {
  const ev: NoteFxEvent = { note, time: 0, gate: 0.5, accent: false };
  return new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, ...p })
    .process([ev], ctx)
    .map((e) => e.note);
};

describe('the named voicings are untouched', () => {
  it('still play what they always played', () => {
    expect(play({}, 60)).toEqual([60, 64, 67]);            // maj
    expect(play({ chordType: 'min7' }, 60)).toEqual([60, 63, 67, 70]);
  });

  it('are not conformed unless asked', () => {
    // D major in C major is D-F#-A: out of key, and left alone by default.
    expect(play({}, 62)).toEqual([62, 66, 69]);
  });
});

describe('free intervals', () => {
  it('default to the major triad, so switching to free changes nothing', () => {
    expect(play({ chordType: 'free' }, 60)).toEqual(play({}, 60));
  });

  it('reach voicings no chord name has', () => {
    // A fourth, a minor seventh and an octave-and-a-second up.
    expect(play({ chordType: 'free', i1: 5, i2: 10, i3: 14 }, 60)).toEqual([60, 65, 70, 74]);
  });

  it('treat 0 as a voice switched off, not a doubled root', () => {
    expect(play({ chordType: 'free', i1: 7, i2: 0, i3: 0 }, 60)).toEqual([60, 67]);
  });

  it('go down as well as up', () => {
    expect(play({ chordType: 'free', i1: -5, i2: 4, i3: 0 }, 60)).toEqual([60, 55, 64]);
  });
});

describe('IN KEY', () => {
  it('pulls an out-of-key chord into the key', () => {
    // D major in C major is D-F#-A. Conformed it becomes D-G-A: every note
    // in key, and NOT the diatonic Dm a musician would name.
    //
    // That is snapToScale, not this processor. In a major scale every
    // out-of-scale note sits exactly between its two neighbours, so every
    // conform is a tie, and the shared helper resolves ties upward — the
    // same behaviour random-processor, pattern-library and example-loader
    // already rely on. Getting Dm would need a CHORD-aware conform rather
    // than a scale-aware one, which is a second tap (Karst has exactly that
    // distinction: its pitch_conform exposes 'scale' and 'chord' separately).
    expect(play({ conform: 'scale' }, 62)).toEqual([62, 67, 69]);
  });

  it('leaves an in-key chord exactly where it was', () => {
    expect(play({ conform: 'scale' }, 60)).toEqual([60, 64, 67]);
  });

  it('makes free intervals safe, which is the point of having both', () => {
    // Three arbitrary offsets, every one landing on a degree of C major.
    const notes = play({ chordType: 'free', i1: 3, i2: 6, i3: 10, conform: 'scale' }, 60);
    const IN_C = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const n of notes) expect(IN_C.has(((n % 12) + 12) % 12), `${n} is out of key`).toBe(true);
  });

  it('drops a voice that conforms onto one already sounding', () => {
    // +1 and +2 from C both land on D once conformed (C# ties upward), and a
    // doubled note is a wasted voice that only makes the chord louder.
    const notes = play({ chordType: 'free', i1: 1, i2: 2, i3: 0, conform: 'scale' }, 60);
    expect(new Set(notes).size).toBe(notes.length);
    expect(notes).toEqual([60, 62]);
  });

  it('stays off when there is no tonality, rather than guessing one', () => {
    // A wrong key is worse than no key: with no context the chord is untouched.
    expect(play({ conform: 'scale' }, 62, NO_KEY)).toEqual([62, 66, 69]);
  });
});

describe('the octave shift still composes with all of it', () => {
  it('transposes a conformed free voicing as a whole', () => {
    const base = play({ chordType: 'free', i1: 4, i2: 7, i3: 0, conform: 'scale' }, 60);
    const up = play({ chordType: 'free', i1: 4, i2: 7, i3: 0, conform: 'scale', octaveOn: true, octave: 1 }, 60);
    expect(up).toEqual(base.map((n) => n + 12));
  });
});

// ── IN KEY: chord ────────────────────────────────────────────────────────────
// The second tap. Scale keeps you in the key and still lets you play a note the
// chord does not contain; chord locks you to three pitch classes and cannot
// sound wrong against the harmony — nor can it sound like a melody. Karst draws
// the same line, exposing 'scale' and 'chord' side by side on pitch_conform.
import { chordTonesOf } from '../core/musicality';

/** C major: I=C-E-G, ii=D-F-A, V=G-B-D. */
const inC = (degree: number, over: Partial<ChordProcessorParams>, note: number) =>
  new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, ...over })
    .process([{ note, time: 0, gate: 0.5, accent: false }], { ...C_MAJOR, chordDegree: degree })
    .map((e) => e.note);

describe('chordTonesOf', () => {
  it('stacks thirds over the degree, taking the quality from the scale', () => {
    expect(chordTonesOf(0, 'major', 0)).toEqual([0, 4, 7]);    // I  = C major
    expect(chordTonesOf(0, 'major', 1)).toEqual([2, 5, 9]);    // ii = D minor
    expect(chordTonesOf(0, 'major', 4)).toEqual([7, 11, 2]);   // V  = G major
  });

  it('wraps over the scale\'s own length, not over seven', () => {
    // A pentatonic has five degrees, so the wrap has to follow it.
    const pent = chordTonesOf(0, 'pentMinor', 0);
    expect(pent.length).toBeGreaterThan(1);
    for (const pc of pent) expect(chordTonesOf(0, 'pentMinor', 0)).toContain(pc);
  });
});

describe('IN KEY: chord', () => {
  it('pulls every note onto the chord sounding now', () => {
    // A maj triad played on D, over the ii chord (D-F-A): the F# is not a chord
    // tone and lands on the nearest one.
    const notes = inC(1, { conform: 'chord' }, 62);
    const tones = new Set(chordTonesOf(0, 'major', 1));
    for (const n of notes) expect(tones.has(((n % 12) + 12) % 12), `${n} is not a chord tone`).toBe(true);
  });

  it('is stricter than scale — it refuses notes the key allows', () => {
    // F natural is IN the key of C but NOT in the I chord (C-E-G).
    const overI = inC(0, { chordType: 'free', i1: 5, i2: 0, i3: 0, conform: 'chord' }, 60);
    const scaled = play({ chordType: 'free', i1: 5, i2: 0, i3: 0, conform: 'scale' }, 60);
    expect(scaled).toContain(65);          // scale keeps the F
    expect(overI).not.toContain(65);       // chord does not
  });

  it('follows the chord as the progression moves', () => {
    const onI = inC(0, { conform: 'chord' }, 60);
    const onV = inC(4, { conform: 'chord' }, 60);
    expect(onI).not.toEqual(onV);
  });

  it('falls back to SCALE when the session names no chord', () => {
    // A wrong chord would be worse than none, but the song still has a key, and
    // a note in the key is nearer what was asked for than a note outside it.
    const noChord = play({ conform: 'chord' }, 62);          // no chordDegree in ctx
    const asScale = play({ conform: 'scale' }, 62);
    expect(noChord).toEqual(asScale);
  });

  it('does nothing at all with no tonality, chord asked for or not', () => {
    expect(play({ conform: 'chord' }, 62, NO_KEY)).toEqual([62, 66, 69]);
  });
});
