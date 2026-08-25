import { describe, it, expect } from 'vitest';
import type { NoteEvent } from '../core/notes';
import { pitchPool } from './pool';

const n = (start: number, midi: number, velocity = 100): NoteEvent =>
  ({ start, duration: 24, midi, velocity });

describe('the pitch pool', () => {
  it('states the material in the order the material states it', () => {
    const pool = pitchPool([n(48, 64), n(0, 60), n(24, 62)]);
    expect(pool.map((p) => p.midi)).toEqual([60, 62, 64]);
  });

  it('keeps duplicates, because eight roots is not one root', () => {
    const pool = pitchPool([n(0, 36), n(24, 36), n(48, 36)]);
    expect(pool).toHaveLength(3);
  });

  it('orders a chord low to high, so the same bar always reads the same', () => {
    const a = pitchPool([n(0, 67), n(0, 60), n(0, 64)]).map((p) => p.midi);
    const b = pitchPool([n(0, 60), n(0, 64), n(0, 67)]).map((p) => p.midi);
    expect(a).toEqual(b);
    expect(a).toEqual([60, 64, 67]);
  });

  it('carries the material dynamics through', () => {
    expect(pitchPool([n(0, 60, 120)])[0].velocity).toBe(120);
  });

  it('drops a note whose numbers are not numbers', () => {
    expect(pitchPool([n(NaN, 60), n(0, NaN), n(0, 60)])).toHaveLength(1);
  });

  it('reads empty material as an empty pool', () => {
    expect(pitchPool([])).toEqual([]);
  });
});
