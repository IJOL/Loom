// src/notefx/chord-processor.test.ts
import { describe, it, expect } from 'vitest';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS } from './chord-processor';
import type { NoteFxEvent } from './notefx-types';

const ev = (note: number): NoteFxEvent => ({ note, time: 0.5, gate: 1.0, accent: true });

describe('ChordProcessor', () => {
  it('major triad: 1 note → 3 simultaneous notes at the same time/gate', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj' });
    const out = p.process([ev(60)], { bpm: 120 });
    expect(out.map((e) => e.note)).toEqual([60, 64, 67]); // root, +4, +7
    expect(out.every((e) => e.time === 0.5)).toBe(true);
    expect(out.every((e) => e.gate === 1.0)).toBe(true);
  });

  it('minor triad uses a flat third', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'min' });
    expect(p.process([ev(60)], { bpm: 120 }).map((e) => e.note)).toEqual([60, 63, 67]);
  });

  it('accent propagates to every chord note', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj' });
    const out = p.process([{ note: 60, time: 0, gate: 1, accent: true }], { bpm: 120 });
    expect(out.every((e) => e.accent === true)).toBe(true);
  });

  it('octave shift transposes the whole chord — only once switched on', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj', octaveOn: true, octave: 1 });
    expect(p.process([ev(60)], { bpm: 120 }).map((e) => e.note)).toEqual([72, 76, 79]);
  });

  // --- diatonic mode: the scale decides the quality, per degree ---
  describe('diatonic chords', () => {
    const cMajor = { bpm: 120, key: 0, scale: 'major' as const };
    const diatonic = (over: Partial<typeof CHORD_PROCESSOR_DEFAULTS> = {}) =>
      new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'diatonic', ...over });

    it('I in C major is a major triad, ii is minor, vii° is diminished — nobody says so', () => {
      const p = diatonic();
      expect(p.process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 64, 67]); // C E G
      expect(p.process([ev(62)], cMajor).map((e) => e.note)).toEqual([62, 65, 69]); // D F A
      expect(p.process([ev(59)], cMajor).map((e) => e.note)).toEqual([59, 62, 65]); // B D F
    });

    it('notes controls how many thirds are stacked (1..5)', () => {
      expect(diatonic({ notes: 1 }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60]);
      expect(diatonic({ notes: 4 }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 64, 67, 71]);
      expect(diatonic({ notes: 5 }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 64, 67, 71, 74]);
    });

    it('an out-of-scale played note is snapped to the scale before stacking', () => {
      // C#4 snaps up to D4 (ties resolve up, same as snapToScale) → ii chord
      expect(diatonic().process([ev(61)], cMajor).map((e) => e.note)).toEqual([62, 65, 69]);
    });

    it('without a tonality the played note passes through untouched', () => {
      expect(diatonic().process([ev(61)], { bpm: 120 }).map((e) => e.note)).toEqual([61]);
    });

    it('inversion rotates chord tones up an octave, one per step', () => {
      // C E G → inv 1: E G C' → inv 2: G C' E'
      expect(diatonic({ inversion: 1 }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([64, 67, 72]);
      expect(diatonic({ inversion: 2 }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([67, 72, 76]);
    });

    it('open spreads the voicing: every second tone moves up an octave', () => {
      // C E G → C G E' (sorted): root + fifth + tenth, the guitar-ish open triad
      expect(diatonic({ open: true }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 67, 76]);
    });

    it('add oct up / down double the played root an octave away', () => {
      expect(diatonic({ addOctUp: true }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 64, 67, 72]);
      expect(diatonic({ addOctDown: true }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([48, 60, 64, 67]);
    });

    it('color adds the tone two thirds above the top of the stack (add9 on a triad)', () => {
      // C E G → top G is degree 4 → +4 degrees = D, strictly above the top → D5
      expect(diatonic({ color: true }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 64, 67, 74]);
    });

    it('fxScale override deviates from the session scale without touching the key', () => {
      // Session says C major; the card says minor → C Eb G
      expect(diatonic({ fxScale: 'minor' }).process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 63, 67]);
    });

    it('fxKey override retunes the card to its own root', () => {
      // D major on the card, whatever the session says → D F# A
      const p = diatonic({ fxKey: '2', fxScale: 'major' });
      expect(p.process([ev(62)], cMajor).map((e) => e.note)).toEqual([62, 66, 69]);
    });

    it('a full local override works with no session tonality at all', () => {
      const p = diatonic({ fxKey: '0', fxScale: 'major' });
      expect(p.process([ev(60)], { bpm: 120 }).map((e) => e.note)).toEqual([60, 64, 67]);
    });

    it('custom scale: the painted mask is the scale, stacked like any other', () => {
      // Whole-tone mask {0,2,4,6,8,10} → every other degree from C: C E G#
      const mask = 0b010101010101;
      const p = diatonic({ fxScale: 'custom', customMask: mask });
      expect(p.process([ev(60)], cMajor).map((e) => e.note)).toEqual([60, 64, 68]);
    });

    it('alter pushes exactly one chord tone out of the scale, the rest untouched', () => {
      const out = diatonic({ alter: true }).process([ev(60)], cMajor).map((e) => e.note);
      expect(out.length).toBe(3);
      const inC = (n: number) => [0, 2, 4, 5, 7, 9, 11].includes(((n % 12) + 12) % 12);
      expect(out.filter((n) => !inC(n)).length).toBe(1);
      expect(out.filter(inC).length).toBe(2);
    });
  });

  // --- filter: Reason's "Filter Notes: on" — out-of-scale notes go silent ---
  describe('conform filter', () => {
    it('drops the out-of-scale notes of a named chord instead of correcting them', () => {
      // maj on D in C major is D F# A; F# is silenced, not moved
      const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj', conform: 'filter' });
      expect(p.process([ev(62)], { bpm: 120, key: 0, scale: 'major' }).map((e) => e.note)).toEqual([62, 69]);
    });

    it('without a tonality nothing is filtered', () => {
      const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj', conform: 'filter' });
      expect(p.process([ev(62)], { bpm: 120 }).map((e) => e.note)).toEqual([62, 66, 69]);
    });
  });
});
