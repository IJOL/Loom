import { describe, it, expect } from 'vitest';
import { pxToBar, clampBarRegion } from './arrangement-brace';

describe('arrangement-brace math', () => {
  it('pxToBar maps px to bars given pxPerBar, snapped to whole bars', () => {
    expect(pxToBar(0, 80)).toBe(0);
    expect(pxToBar(85, 80)).toBe(1);   // nearest bar
    expect(pxToBar(160, 80)).toBe(2);
  });
  it('clampBarRegion keeps start<end, min 1 bar, within 0..total', () => {
    expect(clampBarRegion(5, 2, 8)).toEqual({ start: 2, end: 5 });
    expect(clampBarRegion(3, 3, 8)).toEqual({ start: 3, end: 4 });
    expect(clampBarRegion(-2, 99, 8)).toEqual({ start: 0, end: 8 });
  });
});
