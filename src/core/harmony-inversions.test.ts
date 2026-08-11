// A chord part rebuilt in root position every bar jumps by as much as eleven
// semitones between bars — measured over i-VI-III-VII in A minor, 61 semitones
// of movement across four bars. Inversions are the standard answer: the same
// chord, its notes in a different order, chosen to sit near the last one.
import { describe, it, expect } from 'vitest';
import { diatonicTriad, inversions, nearestVoicing, renderChordComp } from './harmony';
import { inScale } from './musicality';
import { progressionById } from '../arranger/progression';
import { TICKS_PER_STEP } from './notes';

const KEY = 9;              // A
const SCALE = 'minor' as const;
const BASE = 48;
const BAR_TICKS = TICKS_PER_STEP * 16;
const PROG = progressionById('i-VI-III-VII')!.chords;

/** Total semitone movement between two ascending voicings, voice by voice. */
const movement = (a: number[], b: number[]) =>
  a.reduce((sum, m, i) => sum + Math.abs(m - b[i]), 0);

describe('inversions', () => {
  it('gives a triad its three positions, each still ascending', () => {
    // Ascending because the caller compares voicings voice by voice; a
    // re-ordered one would compare against the wrong note.
    const inv = inversions(diatonicTriad(0, BASE, KEY, SCALE));
    expect(inv).toHaveLength(3);
    for (const v of inv) {
      expect(v[0]).toBeLessThan(v[1]);
      expect(v[1]).toBeLessThan(v[2]);
    }
  });

  it('keeps the same chord — the same pitch classes in every position', () => {
    // An inversion reorders voices. A position that changed WHICH notes are in
    // the chord would be a different chord, which is the one thing it is not.
    const t = diatonicTriad(0, BASE, KEY, SCALE);
    const classes = (v: number[]) => [...new Set(v.map((m) => ((m % 12) + 12) % 12))].sort();
    for (const v of inversions(t)) expect(classes(v)).toEqual(classes(t));
  });
});

describe('nearestVoicing', () => {
  it('gives root position when there is nothing to be near', () => {
    const t = diatonicTriad(2, BASE, KEY, SCALE);
    expect(nearestVoicing(t, null)).toEqual(t);
  });

  it('moves less than root position over a real progression', () => {
    // The whole point, as a number rather than an adjective.
    let rootTotal = 0;
    let voicedTotal = 0;
    let prevRoot: number[] | null = null;
    let prevVoiced: number[] | null = null;
    for (const c of PROG) {
      const triad = diatonicTriad(c.degree, BASE, KEY, SCALE);
      const voiced = nearestVoicing(triad, prevVoiced);
      if (prevRoot) rootTotal += movement(triad, prevRoot);
      if (prevVoiced) voicedTotal += movement(voiced, prevVoiced);
      prevRoot = triad;
      prevVoiced = voiced;
    }
    expect(voicedTotal).toBeLessThan(rootTotal);
  });

  it('stays within an octave of where the chord itself sits', () => {
    // Unbounded, a long progression walks the part out of its register one
    // small nearest step at a time — every move locally reasonable and the sum
    // of them not.
    let prev: number[] | null = null;
    for (let lap = 0; lap < 8; lap++) {
      for (const c of PROG) {
        const triad = diatonicTriad(c.degree, BASE, KEY, SCALE);
        const voiced = nearestVoicing(triad, prev);
        expect(Math.abs(voiced[0] - triad[0])).toBeLessThanOrEqual(12);
        prev = voiced;
      }
    }
  });

  it('never leaves the scale', () => {
    let prev: number[] | null = null;
    for (const c of PROG) {
      const voiced = nearestVoicing(diatonicTriad(c.degree, BASE, KEY, SCALE), prev);
      for (const m of voiced) expect(inScale(m, KEY, SCALE)).toBe(true);
      prev = voiced;
    }
  });

  it('leaves a voicing of a different size alone', () => {
    // A seventh chord against a triad has no voice-by-voice comparison to make.
    const t = diatonicTriad(0, BASE, KEY, SCALE);
    expect(nearestVoicing(t, [40, 44])).toEqual(t);
  });
});

describe('renderChordComp voice-leads', () => {
  it('keeps the same rhythm and stays in the scale', () => {
    // What must NOT change with the improvement: the hits and the harmony.
    const melody = [0, 1, 2, 3].map((bar) => ({
      start: bar * BAR_TICKS, duration: BAR_TICKS, midi: 57, velocity: 100,
    }));
    const out = renderChordComp(melody, {
      key: KEY, scale: SCALE, style: 'ambient', bars: 4, barTicks: BAR_TICKS, octaveBase: BASE,
    });
    // ambient is SUSTAINED: one hit per bar, three notes each.
    expect(out).toHaveLength(4 * 3);
    for (const n of out) expect(inScale(n.midi, KEY, SCALE)).toBe(true);
  });

  it('moves less between bars than it used to', () => {
    // The audible half. Same melody, so the chord ROOTS are identical; only the
    // octave each voice sits in changes.
    const melody = [0, 1, 2, 3].map((bar) => ({
      start: bar * BAR_TICKS, duration: BAR_TICKS, midi: [57, 53, 60, 55][bar], velocity: 100,
    }));
    const out = renderChordComp(melody, {
      key: KEY, scale: SCALE, style: 'ambient', bars: 4, barTicks: BAR_TICKS, octaveBase: BASE,
    });
    const barOf = (i: number) =>
      out.filter((n) => n.start === i * BAR_TICKS).map((n) => n.midi).sort((a, b) => a - b);
    let total = 0;
    for (let bar = 1; bar < 4; bar++) total += movement(barOf(bar), barOf(bar - 1));
    // Root position over these roots moves 61 semitones; anything near that is
    // the old behaviour still in place.
    expect(total).toBeLessThan(30);
  });
});
