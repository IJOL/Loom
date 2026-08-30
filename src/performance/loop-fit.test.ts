import { describe, it, expect } from 'vitest';
import { fitLoopToBars } from './loop-fit';
import { songBarSec, } from '../core/song-position';
import { DEFAULT_METER } from '../core/meter';

const barSec = songBarSec(120, DEFAULT_METER); // 2s at 4/4

describe('fitLoopToBars', () => {
  it('a loop a hair short of 4 bars fits to 4 with stretch just under 1', () => {
    const { bars, stretch } = fitLoopToBars(4 * barSec * 0.98, 120, DEFAULT_METER);
    expect(bars).toBe(4);
    expect(stretch).toBeGreaterThan(0.95);
    expect(stretch).toBeLessThan(1.0);
  });

  it('0.6 of a bar rounds up to 1; 1.4 bars rounds down to 1', () => {
    expect(fitLoopToBars(0.6 * barSec, 120, DEFAULT_METER).bars).toBe(1);
    expect(fitLoopToBars(1.4 * barSec, 120, DEFAULT_METER).bars).toBe(1);
    expect(fitLoopToBars(1.6 * barSec, 120, DEFAULT_METER).bars).toBe(2);
  });

  it('never fits to zero bars, however short the file', () => {
    const { bars, stretch } = fitLoopToBars(0.05, 120, DEFAULT_METER);
    expect(bars).toBe(1);
    expect(stretch).toBeGreaterThan(0);
  });

  it('stretch is exactly duration / (bars·barSec)', () => {
    const dur = 3.3;
    const { bars, stretch } = fitLoopToBars(dur, 120, DEFAULT_METER);
    expect(stretch * bars * barSec).toBeCloseTo(dur, 9);
  });
});
