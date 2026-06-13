import { describe, it, expect } from 'vitest';
import { clampBpm, formatBpm, BPM_MIN, BPM_MAX } from './bpm';

describe('clampBpm', () => {
  it('preserves a fractional tempo — NO integer rounding (drift fix)', () => {
    // A detected 127.63 must NOT become 128, or native audio drifts vs the grid.
    expect(clampBpm(127.63)).toBeCloseTo(127.63, 2);
    expect(clampBpm(127.63)).not.toBe(128);
  });
  it('clamps to [BPM_MIN, BPM_MAX] without rounding inside the range', () => {
    expect(clampBpm(10)).toBe(BPM_MIN);
    expect(clampBpm(9999)).toBe(BPM_MAX);
    expect(clampBpm(90.5)).toBeCloseTo(90.5, 2);
  });
});

describe('formatBpm', () => {
  it('shows integers cleanly and fractions to 2 dp', () => {
    expect(formatBpm(128)).toBe('128');
    expect(formatBpm(127.634)).toBe('127.63');
  });
});
