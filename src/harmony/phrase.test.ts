// "Super estático" was a measurement, not an impression: a comp over four bars
// put a chord on every eighth of every bar, so the four came out identical
// apart from which chord they spelled. These tests hold the three properties
// that complaint is the absence of — and every one of them is countable, which
// is the point: whether it sounds GOOD needs ears, whether it is the same thing
// four times does not.

import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { renderComp } from './parts/comp';
import { renderBass } from './parts/bass';
import { renderArp } from './parts/arp';
import { playsInBar, isTurnaround, phraseFloor } from './phrase';

const BAR = TICKS_PER_QUARTER * 4;
// 'trance' comps in EIGHTHS — eight hits a bar, every one on the grid. It is
// the busiest shape there is, so it is where the shaping has to show.
const o = { key: 0, scale: 'minor' as const, style: 'trance' as const, barTicks: BAR, octaveBase: 48 };
const FOUR: Progression = [
  { degree: 0, bars: 1 }, { degree: 6, bars: 1 }, { degree: 0, bars: 1 }, { degree: 4, bars: 1 },
];

/** The set of onsets in each bar, as a comparable string per bar. */
const barShapes = (notes: NoteEvent[], bars: number): string[] =>
  Array.from({ length: bars }, (_, b) => [...new Set(notes
    .filter((n) => n.start >= b * BAR && n.start < (b + 1) * BAR)
    .map((n) => Math.round((n.start % BAR) / TICKS_PER_STEP)))].sort((x, y) => x - y).join(','));

describe('phrase position decides what plays', () => {
  it('the opening bar keeps everything', () => {
    expect(phraseFloor({ bar: 0, bars: 4 })).toBe(0);
  });

  it('the middle bars drop the ordinary offbeat', () => {
    // 0.5 is exactly an offbeat's weight, and the common shapes put half their
    // hits there. A floor under it would look implemented and remove nothing.
    expect(playsInBar(2 * TICKS_PER_STEP, BAR, { bar: 1, bars: 4 })).toBe(false);
    expect(playsInBar(0, BAR, { bar: 1, bars: 4 })).toBe(true);
  });

  it('the last bar is the turnaround, and only when there is a phrase', () => {
    expect(isTurnaround({ bar: 3, bars: 4 })).toBe(true);
    expect(isTurnaround({ bar: 1, bars: 2 })).toBe(false);   // too short to shape
  });

  it('a two-bar loop is left alone entirely', () => {
    // Shaping it would leave one bar of music out of two.
    for (const bar of [0, 1]) expect(phraseFloor({ bar, bars: 2 })).toBe(0);
  });
});

describe('the comp stops being the same bar four times', () => {
  it('plays more than one shape across the phrase', () => {
    const shapes = barShapes(renderComp(FOUR, o), 4);
    expect(new Set(shapes).size).toBeGreaterThan(1);
  });

  it('opens fuller than it continues', () => {
    const shapes = barShapes(renderComp(FOUR, o), 4);
    expect(shapes[0].split(',').length).toBeGreaterThan(shapes[1].split(',').length);
  });

  it('leaves the turnaround hole — silence, then the run back in', () => {
    const last = renderComp(FOUR, o).filter((n) => n.start >= 3 * BAR);
    const firstHalf = last.filter((n) => (n.start % BAR) < BAR / 2);
    expect(firstHalf.length).toBe(0);
    expect(last.length).toBeGreaterThan(0);
  });

  it('is markedly less dense overall than it was', () => {
    // It used to be 8 hits × 3 notes × 4 bars = 96, with no hole anywhere.
    expect(renderComp(FOUR, o).length).toBeLessThan(96 * 0.7);
  });
});

describe('the bass is thinned but never holed', () => {
  it('keeps a note on every downbeat that is not the turnaround', () => {
    const bass = renderBass(FOUR, o);
    for (const bar of [0, 1, 2]) {
      expect(bass.some((n) => n.start === bar * BAR)).toBe(true);
    }
  });

  it('still varies across the phrase', () => {
    expect(new Set(barShapes(renderBass(FOUR, o), 4)).size).toBeGreaterThan(1);
  });
});

describe('the arp keeps running, and only drops out to turn', () => {
  it('is untouched in the bars that are not the turnaround', () => {
    const arp = renderArp(FOUR, o);
    for (const bar of [0, 1, 2]) {
      expect(arp.filter((n) => n.start >= bar * BAR && n.start < (bar + 1) * BAR).length)
        .toBe(BAR / TICKS_PER_STEP);
    }
  });

  it('drops out for the first half of the turnaround', () => {
    const last = renderArp(FOUR, o).filter((n) => n.start >= 3 * BAR);
    expect(last.every((n) => (n.start % BAR) >= BAR / 2)).toBe(true);
    expect(last.length).toBeGreaterThan(0);
  });
});
