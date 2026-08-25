import { describe, it, expect } from 'vitest';
import {
  chordPitch, clampChord, stepTones, toneSetAt, DEFAULT_CHORD, type ChordSpec,
} from './chord';
import { chordTonesOf, degreesOf, inScale } from '../core/musicality';
import type { Progression } from '../arranger/progression';

// C major, and a progression that spends a bar on each of I - vi - IV - V.
const C = { key: 0, scale: 'major' as const };
const PROG: Progression = [
  { degree: 0, bars: 1 }, { degree: 5, bars: 1 },
  { degree: 3, bars: 1 }, { degree: 4, bars: 1 },
];

const spec = (o: Partial<ChordSpec> = {}): ChordSpec =>
  clampChord({ ...DEFAULT_CHORD, ...o });
const at = (bar = 0, head = 0) => ({ head, bar });

describe('CHORD', () => {
  it('leaves the line alone when it is off', () => {
    // Off means off in BOTH halves. A voicing offset that still moved while the
    // conform was inert is half a control working, which reads as a bug in
    // whichever half you notice second.
    const s = spec({ conform: 'off', pitch: 3, mod: 1 });
    for (const midi of [60, 61, 66, 73]) {
      expect(chordPitch(midi, s, C, PROG, at())).toBe(midi);
    }
  });

  it('puts every note in the key on SCALE', () => {
    const s = spec({ conform: 'scale' });
    for (let midi = 48; midi < 84; midi++) {
      expect(inScale(chordPitch(midi, s, C, PROG, at()), C.key, C.scale)).toBe(true);
    }
  });

  it('puts every note on the sounding CHORD, bar by bar', () => {
    const s = spec({ conform: 'chord' });
    for (let bar = 0; bar < 4; bar++) {
      const tones = chordTonesOf(C.key, C.scale, PROG[bar].degree);
      for (let midi = 48; midi < 84; midi++) {
        const out = chordPitch(midi, s, C, PROG, at(bar));
        expect(tones).toContain(((out % 12) + 12) % 12);
      }
    }
  });

  it('moves with the progression rather than standing on one chord', () => {
    // The whole point of asking the song rather than the pattern.
    const s = spec({ conform: 'chord' });
    const perBar = [0, 1, 2, 3].map((bar) => chordPitch(62, s, C, PROG, at(bar)));
    expect(new Set(perBar).size).toBeGreaterThan(1);
  });

  it('falls back to the key\'s own triad when there is no progression', () => {
    // Degree 0 is what "in this key" means when nothing has said otherwise.
    expect(toneSetAt(spec({ conform: 'chord' }), C, [], 0))
      .toEqual(chordTonesOf(C.key, C.scale, 0));
  });

  it('walks the SET, not semitones, when the pitch offset moves', () => {
    // A step that meant a semitone would be a transposition, and transposing a
    // lane is the weave's octave fold — a different control for a different job.
    const s = (pitch: number) => spec({ conform: 'chord', pitch });
    const root = chordPitch(60, s(0), C, PROG, at(0));
    const third = chordPitch(60, s(1), C, PROG, at(0));
    const fifth = chordPitch(60, s(2), C, PROG, at(0));
    expect(third).toBeGreaterThan(root);
    expect(fifth).toBeGreaterThan(third);
    // Three tones is an octave for a triad, which is what makes it the maximum
    // a full-depth mod spans.
    expect(chordPitch(60, s(3), C, PROG, at(0))).toBe(root + 12);
  });

  it('stays on the chord however far the offset walks', () => {
    const tones = chordTonesOf(C.key, C.scale, 0);
    for (let n = -7; n <= 7; n++) {
      const out = chordPitch(60, spec({ conform: 'chord', pitch: n }), C, PROG, at(0));
      expect(tones).toContain(((out % 12) + 12) % 12);
    }
  });

  it('varies the voicing step by step once MOD is open, and never leaves', () => {
    const s = spec({ conform: 'chord', mod: 1 });
    const tones = chordTonesOf(C.key, C.scale, 0);
    const out = Array.from({ length: 16 }, (_, h) => chordPitch(60, s, C, PROG, at(0, h)));
    expect(new Set(out).size).toBeGreaterThan(1);
    for (const o of out) expect(tones).toContain(((o % 12) + 12) % 12);
  });

  it('answers the same step the same way, every time', () => {
    const s = spec({ conform: 'chord', mod: 0.7, pitch: 2 });
    expect(chordPitch(65, s, C, PROG, at(2, 9))).toBe(chordPitch(65, s, C, PROG, at(2, 9)));
  });

  it('clamps a stored spec instead of trusting it', () => {
    expect(clampChord({ conform: 'nonsense' as never, pitch: 99, mod: 5 }))
      .toMatchObject({ conform: 'off', pitch: 7, mod: 1 });
    expect(clampChord(null)).toEqual(DEFAULT_CHORD);
  });
});

describe('stepping a pitch-class set', () => {
  it('is the identity on an empty set or a zero step', () => {
    expect(stepTones(60, [], 3)).toBe(60);
    expect(stepTones(60, degreesOf(0, 'major'), 0)).toBe(60);
  });

  it('goes up and back down to where it started', () => {
    const pcs = chordTonesOf(0, 'major', 0);
    expect(stepTones(stepTones(60, pcs, 4), pcs, -4)).toBe(60);
  });
});
