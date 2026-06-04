import { describe, it, expect } from 'vitest';
import {
  ticksPerBar, quartersPerBar, stepsPerBar, stepsPerBeat,
  clampMeter, resolveMeter, formatMeter, meterFromLabel,
  DEFAULT_METER, COMMON_METERS,
} from './meter';

describe('meter math', () => {
  it('ticksPerBar for common meters', () => {
    expect(ticksPerBar({ num: 4, den: 4 })).toBe(384);
    expect(ticksPerBar({ num: 3, den: 4 })).toBe(288);
    expect(ticksPerBar({ num: 7, den: 8 })).toBe(336);
    expect(ticksPerBar({ num: 6, den: 8 })).toBe(288);
    expect(ticksPerBar({ num: 9, den: 8 })).toBe(432);
  });

  it('stepsPerBar is an integer for every allowed denominator', () => {
    for (const den of [2, 4, 8, 16]) {
      for (let num = 1; num <= 16; num++) {
        expect(Number.isInteger(stepsPerBar({ num, den }))).toBe(true);
      }
    }
  });

  it('stepsPerBar / stepsPerBeat for common meters', () => {
    expect(stepsPerBar({ num: 4, den: 4 })).toBe(16);
    expect(stepsPerBeat({ num: 4, den: 4 })).toBe(4);
    expect(stepsPerBar({ num: 7, den: 8 })).toBe(14);
    expect(stepsPerBeat({ num: 7, den: 8 })).toBe(2);
  });

  it('quartersPerBar', () => {
    expect(quartersPerBar({ num: 4, den: 4 })).toBe(4);
    expect(quartersPerBar({ num: 7, den: 8 })).toBe(3.5);
  });

  it('clampMeter rejects bad denominators and out-of-range numerators', () => {
    expect(clampMeter({ num: 7, den: 32 })).toEqual({ num: 7, den: 4 });
    expect(clampMeter({ num: 99, den: 8 })).toEqual({ num: 16, den: 8 });
    expect(clampMeter({ num: 0, den: 4 })).toEqual({ num: 1, den: 4 });
  });

  it('resolveMeter defaults missing input to 4/4', () => {
    expect(resolveMeter(undefined)).toEqual(DEFAULT_METER);
    expect(resolveMeter(null)).toEqual(DEFAULT_METER);
    expect(resolveMeter({ num: 7, den: 8 })).toEqual({ num: 7, den: 8 });
  });

  it('formatMeter / meterFromLabel round-trip', () => {
    expect(formatMeter({ num: 7, den: 8 })).toBe('7/8');
    expect(meterFromLabel('7/8')).toEqual({ num: 7, den: 8 });
    expect(meterFromLabel('garbage')).toEqual(DEFAULT_METER);
  });

  it('COMMON_METERS starts with 4/4', () => {
    expect(COMMON_METERS[0]).toEqual({ num: 4, den: 4 });
  });
});
