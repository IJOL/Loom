import { describe, it, expect } from 'vitest';
import {
  effectiveRateHz,
  lfoFreeRatePosToHz, lfoFreeRateHzToPos,
  FREE_RATE_MAX_HZ,
} from './rate-sync';
import type { ModulatorState } from './types';

function lfo(partial: Partial<ModulatorState>): ModulatorState {
  return {
    id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    rateHz: 1, waveform: 'sine', bipolar: true,
    syncToBpm: false,
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

describe('FREE rate knob — logarithmic scale (slow dominates the travel)', () => {
  const bpm = (hz: number) => hz * 60;

  it('the first quarter of the knob stays well under 2 bpm', () => {
    expect(bpm(lfoFreeRatePosToHz(0.25))).toBeLessThan(2);
  });

  it('0% is ~0.05 bpm (a very slow, ~20-minute cycle — not stopped)', () => {
    expect(bpm(lfoFreeRatePosToHz(0))).toBeCloseTo(0.05, 4);
  });

  it('100% = 1200 bpm (20 Hz) — the top', () => {
    expect(lfoFreeRatePosToHz(1)).toBeCloseTo(FREE_RATE_MAX_HZ, 6);
    expect(bpm(lfoFreeRatePosToHz(1))).toBeCloseTo(1200, 3);
  });

  it('is monotonically increasing across the travel', () => {
    let prev = -1;
    for (let p = 0; p <= 1.00001; p += 0.05) {
      const hz = lfoFreeRatePosToHz(p);
      expect(hz).toBeGreaterThan(prev);
      prev = hz;
    }
  });

  it('is logarithmic: equal knob steps multiply the rate by a constant factor', () => {
    const a = lfoFreeRatePosToHz(0.25) / lfoFreeRatePosToHz(0.0);
    const b = lfoFreeRatePosToHz(0.50) / lfoFreeRatePosToHz(0.25);
    expect(b).toBeCloseTo(a, 4);
  });

  it('round-trips Hz → pos → Hz across the range', () => {
    for (const hz of [0.01, 0.1, 1, 4, 10, 20]) {
      expect(lfoFreeRatePosToHz(lfoFreeRateHzToPos(hz))).toBeCloseTo(hz, 4);
    }
  });

  it('clamps out-of-range rates to the knob ends', () => {
    expect(lfoFreeRateHzToPos(40)).toBe(1);   // above the 20 Hz top
    expect(lfoFreeRateHzToPos(0)).toBe(0);    // floored at 0%
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
});
