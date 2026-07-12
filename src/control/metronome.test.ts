import { describe, it, expect } from 'vitest';
import { countInClickTimes } from './metronome';

describe('countInClickTimes', () => {
  it('one 4/4 bar at 120bpm → 4 clicks a half-second apart, accent on beat 1', () => {
    const r = countInClickTimes(0, 120, { num: 4, den: 4 }, 1);
    expect(r.times).toEqual([0, 0.5, 1.0, 1.5]);
    expect(r.accents).toEqual([true, false, false, false]);
    expect(r.endSec).toBe(2.0);
  });

  it('offsets from startSec and honours the meter (3/4)', () => {
    const r = countInClickTimes(10, 120, { num: 3, den: 4 }, 1);
    expect(r.times).toEqual([10, 10.5, 11.0]);
    expect(r.accents).toEqual([true, false, false]);
    expect(r.endSec).toBe(11.5);
  });

  it('two bars accent only each bar’s downbeat', () => {
    const r = countInClickTimes(0, 120, { num: 4, den: 4 }, 2);
    expect(r.times.length).toBe(8);
    expect(r.accents).toEqual([true, false, false, false, true, false, false, false]);
    expect(r.endSec).toBe(4.0);
  });
});
