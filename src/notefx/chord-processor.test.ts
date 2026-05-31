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

  it('octave shift transposes the whole chord', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj', octave: 1 });
    expect(p.process([ev(60)], { bpm: 120 }).map((e) => e.note)).toEqual([72, 76, 79]);
  });
});
