import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { applyNoteMacros } from './macro-notes';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi = 36, vel = 90, dur = TICKS_PER_STEP): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: dur, midi, velocity: vel });

const NEUTRAL = { density: 0.5, energy: 0.5 };
// Steps 0, 4, 8 are strong; 3, 7, 11 are off-sixteenths.
const IN = [hit(0), hit(3), hit(4), hit(7), hit(8), hit(11)];
const avg = (ns: NoteEvent[]) => ns.reduce((s, n) => s + n.velocity, 0) / ns.length;
const hasStep = (ns: NoteEvent[], step: number) =>
  ns.some((n) => n.start === step * TICKS_PER_STEP);

describe('note macros', () => {
  it('changes nothing at the neutral of both', () => {
    // The negative control the whole live layer rests on: neutral means the
    // scene sounds exactly like the material that is there.
    expect(applyNoteMacros(IN, NEUTRAL, BAR)).toEqual(IN);
  });

  it('thins out as density falls', () => {
    expect(applyNoteMacros(IN, { ...NEUTRAL, density: 0.1 }, BAR).length)
      .toBeLessThan(IN.length);
  });

  it('drops weak positions before strong ones', () => {
    const thin = applyNoteMacros(IN, { ...NEUTRAL, density: 0.1 }, BAR);
    expect(hasStep(thin, 0)).toBe(true);
    expect(hasStep(thin, 3)).toBe(false);
  });

  it('never removes the downbeat, however low density goes', () => {
    expect(hasStep(applyNoteMacros(IN, { ...NEUTRAL, density: 0 }, BAR), 0)).toBe(true);
  });

  it('never returns an empty bar, which would read as a dead lane', () => {
    expect(applyNoteMacros(IN, { ...NEUTRAL, density: 0 }, BAR).length).toBeGreaterThan(0);
  });

  it('adds notes as density rises', () => {
    const long = [hit(0, 36, 90, TICKS_PER_STEP * 4), hit(8, 36, 90, TICKS_PER_STEP * 4)];
    expect(applyNoteMacros(long, { ...NEUTRAL, density: 0.95 }, BAR).length)
      .toBeGreaterThan(long.length);
  });

  it('invents no pitch when thickening', () => {
    const long = [hit(0, 36, 90, TICKS_PER_STEP * 4), hit(8, 41, 90, TICKS_PER_STEP * 4)];
    const thick = applyNoteMacros(long, { ...NEUTRAL, density: 0.95 }, BAR);
    const pitchesIn = new Set(long.map((n) => n.midi));
    for (const n of thick) expect(pitchesIn.has(n.midi)).toBe(true);
  });

  it('leaves a sixteenth alone when thickening, because it has nothing to give', () => {
    const short = [hit(0), hit(4)];
    expect(applyNoteMacros(short, { ...NEUTRAL, density: 1 }, BAR)).toEqual(short);
  });

  it('raises velocity as energy rises', () => {
    expect(avg(applyNoteMacros(IN, { ...NEUTRAL, energy: 1 }, BAR))).toBeGreaterThan(avg(IN));
  });

  it('lowers velocity as energy falls', () => {
    expect(avg(applyNoteMacros(IN, { ...NEUTRAL, energy: 0 }, BAR))).toBeLessThan(avg(IN));
  });

  it('does not accent a whole pattern at the neutral', () => {
    // Accent is velocity >= 100 everywhere in Loom. A macro that quietly
    // crossed that line for every note would change the sound of the engine,
    // not its loudness.
    const loud = [hit(0, 36, 99), hit(4, 36, 99)];
    for (const n of applyNoteMacros(loud, NEUTRAL, BAR)) {
      expect(n.velocity).toBeLessThan(100);
    }
  });

  it('keeps velocity inside the legal range at both extremes', () => {
    for (const energy of [0, 1]) {
      for (const n of applyNoteMacros(IN, { ...NEUTRAL, energy }, BAR)) {
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
      }
    }
  });

  it('returns the notes in time order after thickening', () => {
    const long = [hit(0, 36, 90, TICKS_PER_STEP * 4), hit(8, 36, 90, TICKS_PER_STEP * 4)];
    const out = applyNoteMacros(long, { ...NEUTRAL, density: 0.95 }, BAR);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    }
  });

  it('handles an empty bar without inventing anything', () => {
    expect(applyNoteMacros([], { density: 0, energy: 1 }, BAR)).toEqual([]);
  });
});
