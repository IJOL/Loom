import { describe, it, expect } from 'vitest';
import { generate, type GenContext } from './generators';
import { inScale } from './musicality';
import { TICKS_PER_STEP } from './notes';

function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const ctx = (over: Partial<GenContext> = {}): GenContext => ({
  key: 9, scale: 'minor', bars: 1, stepsPerBar: 16, octaveBase: 36,
  rng: mulberry32(1), ...over,
});

describe('genre generators', () => {
  it('bass notes are all in scale and there is at least one', () => {
    const notes = generate('bass', 'acid', ctx());
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });
  it('melody notes are all in scale', () => {
    const notes = generate('melody', 'synthwave', ctx());
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });
  it('beat puts a kick on the first downbeat', () => {
    const notes = generate('beat', 'house', ctx());
    const kicksAtZero = notes.filter((n) => n.midi === 36 && n.start === 0);
    expect(kicksAtZero.length).toBeGreaterThan(0);
  });
  it('acid bass is denser than lofi bass', () => {
    const acid = generate('bass', 'acid', ctx()).length;
    const lofi = generate('bass', 'lofi', ctx()).length;
    expect(acid).toBeGreaterThan(lofi);
  });
  it('is deterministic for a fixed rng seed', () => {
    expect(generate('bass', 'acid', ctx())).toEqual(generate('bass', 'acid', ctx()));
  });

  it('breakbeat bass and melody notes are all in scale', () => {
    for (const kind of ['bass', 'melody'] as const) {
      const notes = generate(kind, 'breakbeat', ctx());
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
    }
  });

  it('breakbeat beat is broken: a kick lands off the beat grid', () => {
    const notes = generate('beat', 'breakbeat', ctx({ stepsPerBar: 16 }));
    const beatTicks = (16 / 4) * TICKS_PER_STEP; // 4 steps/beat × 24 = 96
    const offGridKick = notes.some((n) => n.midi === 36 && n.start % beatTicks !== 0);
    expect(offGridKick).toBe(true);
  });

  it('breakbeat beat still kicks on the first downbeat', () => {
    const notes = generate('beat', 'breakbeat', ctx());
    expect(notes.some((n) => n.midi === 36 && n.start === 0)).toBe(true);
  });
});
