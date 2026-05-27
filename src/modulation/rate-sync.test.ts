import { describe, it, expect } from 'vitest';
import { effectiveRateHz, SYNC_RATIO_MAP } from './rate-sync';
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

describe('SYNC_RATIO_MAP', () => {
  it('contains common ratios', () => {
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/8');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/16');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4T');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4.');
  });
});
