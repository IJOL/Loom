import { describe, it, expect } from 'vitest';
import { quantiseSelectValue, normaliseSelectIndex } from './select-control';

describe('quantiseSelectValue', () => {
  it('maps 0..1 to option index 0..N-1', () => {
    expect(quantiseSelectValue(0,    4)).toBe(0);
    expect(quantiseSelectValue(0.24, 4)).toBe(0);
    expect(quantiseSelectValue(0.25, 4)).toBe(1);
    expect(quantiseSelectValue(0.5,  4)).toBe(2);
    expect(quantiseSelectValue(0.99, 4)).toBe(3);
    expect(quantiseSelectValue(1,    4)).toBe(3);
  });
  it('handles 2 options (toggle)', () => {
    expect(quantiseSelectValue(0.49, 2)).toBe(0);
    expect(quantiseSelectValue(0.5,  2)).toBe(1);
  });
});

describe('normaliseSelectIndex', () => {
  it('inverse of quantiseSelectValue for the option mid-bucket', () => {
    expect(normaliseSelectIndex(0, 4)).toBeCloseTo(0.125, 5);
    expect(normaliseSelectIndex(3, 4)).toBeCloseTo(0.875, 5);
  });
});
