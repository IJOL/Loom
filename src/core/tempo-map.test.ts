import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER } from './notes';
import {
  makeTempoMap, hasTempoChanges, bpmAtTick, tickToSec, secToTick, tickRangeSec,
} from './tempo-map';

const Q = TICKS_PER_QUARTER; // 96 ticks / quarter

describe('makeTempoMap', () => {
  it('empty input → a single default-bpm anchor at tick 0', () => {
    expect(makeTempoMap([])).toEqual([{ tick: 0, bpm: 120 }]);
    expect(makeTempoMap([], 90)).toEqual([{ tick: 0, bpm: 90 }]);
  });
  it('sorts by tick and anchors at 0', () => {
    const m = makeTempoMap([{ tick: 200, bpm: 140 }, { tick: 50, bpm: 100 }]);
    expect(m[0].tick).toBe(0);
    expect(m.map((p) => p.tick)).toEqual([0, 50, 200]);
  });
  it('drops invalid bpm', () => {
    const m = makeTempoMap([{ tick: 0, bpm: 120 }, { tick: 96, bpm: 0 }, { tick: 192, bpm: -5 }]);
    expect(m).toEqual([{ tick: 0, bpm: 120 }]);
  });
});

describe('hasTempoChanges', () => {
  it('false for a single tempo, true for real changes', () => {
    expect(hasTempoChanges(makeTempoMap([{ tick: 0, bpm: 120 }]))).toBe(false);
    expect(hasTempoChanges(makeTempoMap([{ tick: 0, bpm: 120 }, { tick: 96, bpm: 120 }]))).toBe(false);
    expect(hasTempoChanges(makeTempoMap([{ tick: 0, bpm: 120 }, { tick: 96, bpm: 90 }]))).toBe(true);
  });
});

describe('bpmAtTick', () => {
  const m = makeTempoMap([{ tick: 0, bpm: 120 }, { tick: Q, bpm: 60 }]);
  it('returns the tempo in effect at a tick', () => {
    expect(bpmAtTick(m, 0)).toBe(120);
    expect(bpmAtTick(m, Q - 1)).toBe(120);
    expect(bpmAtTick(m, Q)).toBe(60);
    expect(bpmAtTick(m, Q * 4)).toBe(60);
  });
});

describe('tickToSec (constant tempo)', () => {
  const m = makeTempoMap([{ tick: 0, bpm: 120 }]);
  it('a quarter note at 120 BPM = 0.5 s', () => {
    expect(tickToSec(m, Q)).toBeCloseTo(0.5, 6);
    expect(tickToSec(m, 2 * Q)).toBeCloseTo(1.0, 6);
    expect(tickToSec(m, 0)).toBe(0);
  });
});

describe('tickToSec (tempo change)', () => {
  // 120 BPM for one quarter, then 60 BPM
  const m = makeTempoMap([{ tick: 0, bpm: 120 }, { tick: Q, bpm: 60 }]);
  it('integrates piecewise: first quarter 0.5s, next quarter 1.0s', () => {
    expect(tickToSec(m, Q)).toBeCloseTo(0.5, 6);       // 1 quarter @120
    expect(tickToSec(m, 2 * Q)).toBeCloseTo(1.5, 6);   // +1 quarter @60 = +1.0s
    expect(tickToSec(m, 1.5 * Q)).toBeCloseTo(1.0, 6); // half into the 60bpm segment
  });
  it('tickRangeSec over the slow segment', () => {
    expect(tickRangeSec(m, Q, 2 * Q)).toBeCloseTo(1.0, 6);
  });
});

describe('secToTick (inverse round-trip)', () => {
  const m = makeTempoMap([{ tick: 0, bpm: 120 }, { tick: Q, bpm: 60 }, { tick: 3 * Q, bpm: 150 }]);
  it('round-trips tickToSec for many ticks', () => {
    for (const t of [0, Q / 2, Q, 1.5 * Q, 2 * Q, 3 * Q, 4 * Q]) {
      expect(secToTick(m, tickToSec(m, t))).toBeCloseTo(t, 4);
    }
  });
  it('extends past the end at the final tempo', () => {
    const endSec = tickToSec(m, 3 * Q);
    // one more quarter at 150 bpm = 60/150 = 0.4s
    expect(secToTick(m, endSec + 0.4)).toBeCloseTo(4 * Q, 3);
  });
});
