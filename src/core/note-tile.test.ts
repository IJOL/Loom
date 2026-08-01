import { describe, it, expect } from 'vitest';
import { tileNotesToLength } from './note-tile';
import { TICKS_PER_STEP, type NoteEvent } from './notes';

const at = (step: number): NoteEvent =>
  ({ midi: 36, start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, velocity: 90 });

const steps = (ns: readonly NoteEvent[]): number[] =>
  ns.map((n) => n.start / TICKS_PER_STEP).sort((a, b) => a - b);

const BAR = 16 * TICKS_PER_STEP;

describe('repeating a clip\'s content across a new length', () => {
  it('repeats the block once per period', () => {
    expect(steps(tileNotesToLength([at(0), at(4)], BAR, 2 * BAR))).toEqual([0, 4, 16, 20]);
  });

  it('fills a five-bar clip from a two-bar block', () => {
    const out = tileNotesToLength([at(0)], 2 * BAR, 5 * BAR);
    expect(steps(out)).toEqual([0, 32, 64]);
  });

  it('keeps only what starts inside a partial last period', () => {
    const out = tileNotesToLength([at(0), at(12)], BAR, 2 * BAR + 8 * TICKS_PER_STEP);
    expect(steps(out)).toEqual([0, 12, 16, 28, 32]);      // 44 would land past the end
  });

  it('drops what falls outside when the clip shrinks', () => {
    expect(steps(tileNotesToLength([at(0), at(20)], 2 * BAR, BAR))).toEqual([0]);
  });

  it('changes nothing when the length is the same', () => {
    expect(steps(tileNotesToLength([at(0), at(9)], BAR, BAR))).toEqual([0, 9]);
  });

  it('copies the note, it does not alias it', () => {
    const src = at(0);
    const out = tileNotesToLength([src], BAR, 2 * BAR);
    expect(out.filter((n) => n !== src).every((n) => n.midi === src.midi)).toBe(true);
    expect(out.length).toBe(2);
  });

  it('survives a zero period without looping forever', () => {
    expect(steps(tileNotesToLength([at(0), at(40)], 0, BAR))).toEqual([0]);
  });
});
