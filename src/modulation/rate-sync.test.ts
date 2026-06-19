import { describe, it, expect } from 'vitest';
import {
  effectiveRateHz, SYNC_RATIO_MAP,
  lfoFreeRatePosToHz, lfoFreeRateHzToPos,
  FREE_RATE_MID_HZ, FREE_RATE_MAX_HZ,
  parseSyncRatioToBars,
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

describe('effectiveRateHz — SYNC bars-per-cycle model', () => {
  it('4 bars/cycle straight at 120 BPM = 0.125 Hz (one cycle per 4 bars)', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncBars: 4, syncSubdiv: 'straight' }), 120))
      .toBeCloseTo(0.125, 6);
  });
  it('0.25 bars/cycle straight = a quarter note (= old 1/4) → 2 Hz at 120', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncBars: 0.25, syncSubdiv: 'straight' }), 120))
      .toBeCloseTo(2, 6);
  });
  it('triplet is ×3/2 faster than straight', () => {
    const straight = effectiveRateHz(lfo({ syncToBpm: true, syncBars: 0.25, syncSubdiv: 'straight' }), 120);
    const triplet  = effectiveRateHz(lfo({ syncToBpm: true, syncBars: 0.25, syncSubdiv: 'triplet'  }), 120);
    expect(triplet).toBeCloseTo(straight * 3 / 2, 6);
  });
  it('dotted is ×2/3 of straight (longer/slower)', () => {
    const straight = effectiveRateHz(lfo({ syncToBpm: true, syncBars: 0.25, syncSubdiv: 'straight' }), 120);
    const dotted   = effectiveRateHz(lfo({ syncToBpm: true, syncBars: 0.25, syncSubdiv: 'dotted'   }), 120);
    expect(dotted).toBeCloseTo(straight * 2 / 3, 6);
  });
  it('syncBars supersedes a legacy syncRatio when both present', () => {
    const r = effectiveRateHz(lfo({ syncToBpm: true, syncBars: 8, syncRatio: '1/16' }), 120);
    expect(r).toBeCloseTo(2 / (8 * 4), 6);   // uses bars (8), not the 1/16 ratio
  });
});

describe('parseSyncRatioToBars — legacy migration is exact', () => {
  it('parses straight / triplet / dotted labels', () => {
    expect(parseSyncRatioToBars('4/1')).toEqual({ bars: 4, subdiv: 'straight' });
    expect(parseSyncRatioToBars('1/8T')).toEqual({ bars: 0.125, subdiv: 'triplet' });
    expect(parseSyncRatioToBars('1/4.')).toEqual({ bars: 0.25, subdiv: 'dotted' });
    expect(parseSyncRatioToBars('garbage')).toBeNull();
  });
  it('migrated bars reproduce the exact rate of every legacy ratio', () => {
    for (const label of Object.keys(SYNC_RATIO_MAP)) {
      const legacy = effectiveRateHz(lfo({ syncToBpm: true, syncRatio: label }), 120);
      const p = parseSyncRatioToBars(label)!;
      const migrated = effectiveRateHz(
        lfo({ syncToBpm: true, syncBars: p.bars, syncSubdiv: p.subdiv }), 120,
      );
      expect(migrated).toBeCloseTo(legacy, 6);
    }
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
