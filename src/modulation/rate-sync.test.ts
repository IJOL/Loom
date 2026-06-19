import { describe, it, expect } from 'vitest';
import {
  effectiveRateHz, SYNC_RATIO_MAP,
  lfoFreeRatePosToHz, lfoFreeRateHzToPos,
  FREE_RATE_MID_HZ, FREE_RATE_MAX_HZ,
} from './rate-sync';
import type { ModulatorState } from './types';

function lfo(partial: Partial<ModulatorState>): ModulatorState {
  return {
    id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    rateHz: 1, waveform: 'sine', bipolar: true,
    syncToBpm: false, syncRatio: '1/4',
    ...partial,
  };
}

describe('effectiveRateHz — free rate', () => {
  it('returns rateHz unchanged when sync disabled', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: false, rateHz: 7.3 }), 120)).toBe(7.3);
  });
  it('defaults to 1 Hz if rateHz missing', () => {
    expect(effectiveRateHz(lfo({ rateHz: undefined }), 120)).toBe(1);
  });
});

describe('effectiveRateHz — BPM sync', () => {
  it('1/4 at 120 BPM = 2 Hz', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/4' }), 120)).toBe(2);
  });
  it('1/8 at 120 BPM = 4 Hz', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/8' }), 120)).toBe(4);
  });
  it('1/16 at 120 BPM = 8 Hz', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/16' }), 120)).toBe(8);
  });
  it('1/1 at 120 BPM = 0.5 Hz (one cycle per bar)', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/1' }), 120)).toBe(0.5);
  });
  it('1/4T at 120 BPM = 3 Hz (triplet)', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/4T' }), 120)).toBe(3);
  });
});

describe('effectiveRateHz — unknown ratio fallback', () => {
  it('unknown ratio collapses to 1 cycle per beat', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: 'NOPE' }), 120)).toBe(2);
  });
});

describe('FREE rate knob — piecewise scale (slow gets the first half)', () => {
  const bpm = (hz: number) => hz * 60;

  it('50% of the knob = 240 bpm (4 Hz) — the breakpoint', () => {
    expect(lfoFreeRatePosToHz(0.5)).toBeCloseTo(FREE_RATE_MID_HZ, 6);
    expect(bpm(lfoFreeRatePosToHz(0.5))).toBeCloseTo(240, 6);
  });

  it('25% (quarter turn) = 120 bpm (2 Hz) — linear in the slow half', () => {
    expect(bpm(lfoFreeRatePosToHz(0.25))).toBeCloseTo(120, 6);
  });

  it('100% = 1200 bpm (20 Hz) — the top', () => {
    expect(lfoFreeRatePosToHz(1)).toBeCloseTo(FREE_RATE_MAX_HZ, 6);
    expect(bpm(lfoFreeRatePosToHz(1))).toBeCloseTo(1200, 6);
  });

  it('the slow half (0..50%) is linear in bpm', () => {
    // midpoint of the slow half = half the breakpoint rate
    expect(lfoFreeRatePosToHz(0.25)).toBeCloseTo(FREE_RATE_MID_HZ / 2, 6);
  });

  it('the fast half (50..100%) is exponential, not linear', () => {
    // exponential midpoint = geometric mean of 4 and 20 ≈ 8.94 Hz, well below
    // the linear midpoint (12 Hz).
    const mid = lfoFreeRatePosToHz(0.75);
    expect(mid).toBeCloseTo(Math.sqrt(FREE_RATE_MID_HZ * FREE_RATE_MAX_HZ), 4);
    expect(mid).toBeLessThan((FREE_RATE_MID_HZ + FREE_RATE_MAX_HZ) / 2);
  });

  it('round-trips Hz → pos → Hz across the range', () => {
    for (const hz of [0.5, 1, 2, 4, 8, 12, 20]) {
      expect(lfoFreeRatePosToHz(lfoFreeRateHzToPos(hz))).toBeCloseTo(hz, 4);
    }
  });

  it('clamps out-of-range rates to the knob ends', () => {
    expect(lfoFreeRateHzToPos(40)).toBe(1);          // above the 20 Hz top
    expect(lfoFreeRateHzToPos(0)).toBeLessThan(0.01); // floored near 0% (min ~0.02 Hz)
  });
});

describe('SYNC_RATIO_MAP', () => {
  it('contains common ratios', () => {
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/8');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/16');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4T');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4.');
  });
});
