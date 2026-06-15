// src/core/harmony.test.ts
// TDD: pure unit tests for the chord-accompaniment module.
// Assertions are always RELATIVE (no absolute magnitude thresholds).

import { describe, it, expect } from 'vitest';
import { diatonicTriad, melodyToChordRoots, renderChordComp } from './harmony';
import { inScale, scaleDegreeToMidi } from './musicality';
import { TICKS_PER_STEP } from './notes';

// One 4/4 bar = 16 steps × 24 ticks = 384 ticks.
const BAR_TICKS = 16 * TICKS_PER_STEP; // 384
// key = 9 (La / A), scale = 'minor', octaveBase = 48
const KEY = 9;
const SCALE = 'minor' as const;
const OCTAVE = 48;

// ── diatonicTriad ─────────────────────────────────────────────────────────────
describe('diatonicTriad', () => {
  it('returns exactly 3 MIDI pitches', () => {
    const triad = diatonicTriad(0, OCTAVE, KEY, SCALE);
    expect(triad).toHaveLength(3);
  });

  it('all three pitches are in scale', () => {
    for (let root = 0; root < 7; root++) {
      const triad = diatonicTriad(root, OCTAVE, KEY, SCALE);
      for (const midi of triad) {
        expect(inScale(midi, KEY, SCALE)).toBe(true);
      }
    }
  });

  it('notes are ascending (each voice higher than the one below)', () => {
    const triad = diatonicTriad(0, OCTAVE, KEY, SCALE);
    expect(triad[1]).toBeGreaterThan(triad[0]);
    expect(triad[2]).toBeGreaterThan(triad[1]);
  });

  it('root is the scale root when rootDegree=0 at octaveBase', () => {
    // degree 0 should map to octaveBase + key
    const triad = diatonicTriad(0, OCTAVE, KEY, SCALE);
    expect(triad[0]).toBe(OCTAVE + KEY); // 57 = A3
  });

  it('works for major scale too', () => {
    const triad = diatonicTriad(0, OCTAVE, 0, 'major'); // C major
    for (const midi of triad) {
      expect(inScale(midi, 0, 'major')).toBe(true);
    }
    expect(triad).toHaveLength(3);
  });
});

// ── melodyToChordRoots ────────────────────────────────────────────────────────
describe('melodyToChordRoots', () => {
  it('returns one root per bar', () => {
    const roots = melodyToChordRoots([], KEY, SCALE, BAR_TICKS, 4);
    expect(roots).toHaveLength(4);
  });

  it('empty melody → all roots are tonic (0)', () => {
    const roots = melodyToChordRoots([], KEY, SCALE, BAR_TICKS, 3);
    expect(roots).toEqual([0, 0, 0]);
  });

  it('bar full of degree-4 notes → root 4', () => {
    // Build a melody of 4 notes, all pointing at scale degree 4 (the 5th of the scale)
    const deg4Midi = scaleDegreeToMidi(4, OCTAVE, KEY, SCALE);
    const notes = [0, 1, 2, 3].map((i) => ({
      start: i * TICKS_PER_STEP,
      duration: TICKS_PER_STEP,
      midi: deg4Midi,
      velocity: 80,
    }));
    const roots = melodyToChordRoots(notes, KEY, SCALE, BAR_TICKS, 2);
    // bar 0 has all notes at degree 4; bar 1 is empty → carries over root 4
    expect(roots[0]).toBe(4);
    expect(roots[1]).toBe(4); // empty bar repeats previous
  });

  it('most frequent degree wins when multiple degrees present', () => {
    const deg0 = scaleDegreeToMidi(0, OCTAVE, KEY, SCALE); // 1 note at degree 0
    const deg2 = scaleDegreeToMidi(2, OCTAVE, KEY, SCALE); // 3 notes at degree 2
    const notes = [
      { start: 0, duration: 24, midi: deg0, velocity: 80 },
      { start: TICKS_PER_STEP, duration: 24, midi: deg2, velocity: 80 },
      { start: TICKS_PER_STEP * 2, duration: 24, midi: deg2, velocity: 80 },
      { start: TICKS_PER_STEP * 3, duration: 24, midi: deg2, velocity: 80 },
    ];
    const [root] = melodyToChordRoots(notes, KEY, SCALE, BAR_TICKS, 1);
    expect(root).toBe(2);
  });

  it('empty bar after a non-empty bar repeats the previous root', () => {
    const deg5 = scaleDegreeToMidi(5, OCTAVE, KEY, SCALE);
    const notes = [
      { start: 0, duration: 24, midi: deg5, velocity: 80 },
    ];
    // bar 0 has one note at degree 5; bar 1 is empty
    const roots = melodyToChordRoots(notes, KEY, SCALE, BAR_TICKS, 2);
    expect(roots[0]).toBe(5);
    expect(roots[1]).toBe(5);
  });
});

// ── renderChordComp ───────────────────────────────────────────────────────────
describe('renderChordComp', () => {
  const BARS = 2;
  const base = { key: KEY, scale: SCALE, bars: BARS, barTicks: BAR_TICKS, octaveBase: OCTAVE };

  it('produces a note count that is a multiple of 3 per hit', () => {
    const notes = renderChordComp([], { ...base, style: 'lofi' });
    // lofi: 1 hit per bar × 3 notes × 2 bars = 6
    expect(notes.length).toBe(BARS * 3);
  });

  it('all notes are within [0, bars*barTicks)', () => {
    const clipEnd = BARS * BAR_TICKS;
    for (const style of ['house', 'synthwave', 'acid', 'lofi'] as const) {
      const notes = renderChordComp([], { ...base, style });
      for (const n of notes) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start).toBeLessThan(clipEnd);
        expect(n.start + n.duration).toBeLessThanOrEqual(clipEnd);
      }
    }
  });

  it('all notes are in scale', () => {
    for (const style of ['house', 'synthwave', 'acid', 'lofi'] as const) {
      const notes = renderChordComp([], { ...base, style });
      for (const n of notes) {
        expect(inScale(n.midi, KEY, SCALE)).toBe(true);
      }
    }
  });

  it('house: hits land on offbeat steps (2,6,10,14 within each bar)', () => {
    const notes = renderChordComp([], { ...base, style: 'house' });
    const stepTicks = BAR_TICKS / 16;
    const offbeatSteps = new Set([2, 6, 10, 14]);
    // Collect unique start offsets within a bar (mod barTicks), normalised to step units
    const hitSteps = [...new Set(notes.map((n) => Math.round((n.start % BAR_TICKS) / stepTicks)))];
    for (const s of hitSteps) {
      expect(offbeatSteps.has(s)).toBe(true);
    }
  });

  it('lofi: exactly 1 chord (3 notes) per bar, duration = full bar', () => {
    const notes = renderChordComp([], { ...base, style: 'lofi' });
    expect(notes.length).toBe(BARS * 3);
    for (const n of notes) {
      expect(n.duration).toBe(BAR_TICKS);
    }
    // Verify one start per bar
    const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
    expect(starts).toEqual([0, BAR_TICKS]);
  });

  it('synthwave: 8 hits per bar', () => {
    const notes = renderChordComp([], { ...base, style: 'synthwave' });
    // 8 hits/bar × 3 notes × 2 bars
    expect(notes.length).toBe(8 * 3 * BARS);
  });

  it('acid: 2 hits per bar (steps 0 and 8)', () => {
    const notes = renderChordComp([], { ...base, style: 'acid' });
    // 2 hits/bar × 3 notes × 2 bars
    expect(notes.length).toBe(2 * 3 * BARS);
    const stepTicks = BAR_TICKS / 16;
    const hitSteps = [...new Set(notes.map((n) => Math.round((n.start % BAR_TICKS) / stepTicks)))].sort((a, b) => a - b);
    expect(hitSteps).toEqual([0, 8]);
  });

  it('the first hit of each bar has higher velocity (accent) than subsequent hits', () => {
    // Only meaningful for styles with multiple hits per bar
    const notes = renderChordComp([], { ...base, style: 'synthwave' });
    const byBar: Map<number, number[]> = new Map();
    const stepTicks = BAR_TICKS / 16;
    for (const n of notes) {
      const bar = Math.floor(n.start / BAR_TICKS);
      const stepInBar = Math.round((n.start % BAR_TICKS) / stepTicks);
      const key2 = bar * 100 + stepInBar;
      if (!byBar.has(key2)) byBar.set(key2, []);
      byBar.get(key2)!.push(n.velocity);
    }
    const barStarts = [0, BAR_TICKS];
    for (const barStart of barStarts) {
      // step 0 in bar = accent (115), step 2 = non-accent (95)
      const accentKey = Math.floor(barStart / BAR_TICKS) * 100 + 0;
      const otherKey  = Math.floor(barStart / BAR_TICKS) * 100 + 2;
      const accentVels = byBar.get(accentKey)!;
      const otherVels  = byBar.get(otherKey)!;
      expect(accentVels[0]).toBeGreaterThan(otherVels[0]);
    }
  });

  it('empty melody → tonic chord (root 0)', () => {
    const notes = renderChordComp([], { ...base, style: 'lofi' });
    // Tonic triad: diatonicTriad(0, OCTAVE, KEY, SCALE)
    const expected = diatonicTriad(0, OCTAVE, KEY, SCALE);
    // 2 bars × 3 notes = 6 notes, all from root 0 triad
    for (const m of notes.map((n) => n.midi)) {
      expect(expected.includes(m)).toBe(true);
    }
  });
});
