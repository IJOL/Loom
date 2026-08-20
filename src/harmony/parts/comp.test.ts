import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER } from '../../core/notes';
import type { Progression } from '../../arranger/progression';
import { renderComp } from './comp';

const BAR = TICKS_PER_QUARTER * 4;
const STEP = BAR / 16;
// 'trance' maps to 'eighths', which has a hit on step 0 — the one the
// anticipation moves. A style whose shape skips the downbeat would test nothing.
const o = { key: 9, scale: 'minor' as const, style: 'trance' as const, barTicks: BAR, octaveBase: 48 };
const PROG: Progression = [{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }];

describe('renderComp', () => {
  it('plays chords, not single notes', () => {
    const out = renderComp(PROG, o);
    expect(out.filter((n) => n.start === out[0].start).length).toBeGreaterThan(1);
  });

  it('is silent on an empty progression', () => {
    expect(renderComp([], o)).toEqual([]);
  });
});

describe('renderComp anticipates a chord CHANGE', () => {
  it('lands the new chord before the bar line', () => {
    const out = renderComp(PROG, o);
    const early = out.filter((n) => n.start < BAR && n.start > BAR - TICKS_PER_QUARTER);
    expect(early.length).toBeGreaterThan(0);
  });

  it('holds it long enough that the chord still ends where it would have', () => {
    const out = renderComp(PROG, o);
    const early = out.filter((n) => n.start < BAR && n.start % STEP !== 0);
    // The lean is a head start, not a shorter note: the anticipated hit ends no
    // earlier than the same hit would have starting on the bar line.
    for (const n of early) expect(n.start + n.duration).toBeGreaterThanOrEqual(BAR);
  });

  it('does NOT anticipate the first chord — there is nothing to arrive ahead of', () => {
    expect(Math.min(...renderComp(PROG, o).map((n) => n.start))).toBe(0);
  });

  it('does not anticipate a chord that simply continues', () => {
    // Two bars of ONE chord: no change at bar two, so every note stays on the
    // grid. This is the case that separates "leans into a change" from "starts
    // every bar early".
    const out = renderComp([{ degree: 0, bars: 2 }], o);
    expect(out.filter((n) => n.start % STEP !== 0).length).toBe(0);
  });
});

describe('renderComp voices its chords', () => {
  it('moves the second chord to sit near the first', () => {
    const out = renderComp(PROG, o);
    const first = [...new Set(out.filter((n) => n.start === 0).map((n) => n.midi))].sort((a, b) => a - b);
    const second = [...new Set(out.filter((n) => n.start >= BAR - TICKS_PER_QUARTER)
      .map((n) => n.midi))].sort((a, b) => a - b);
    const moved = first.reduce((s, m, i) => s + Math.abs(second[i] - m), 0);
    const naive = first.reduce((s, m, i) => s + Math.abs((second[i] - 12) - m), 0);
    expect(moved).toBeLessThanOrEqual(naive);
  });

  it('accents the downbeat over the off-beats', () => {
    const out = renderComp([{ degree: 0, bars: 1 }], o);
    const down = out.find((n) => n.start === 0)!;
    const off = out.find((n) => n.start > 0)!;
    expect(down.velocity).toBeGreaterThan(off.velocity);
  });
});
