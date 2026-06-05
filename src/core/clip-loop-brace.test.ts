import { describe, it, expect } from 'vitest';
import { pxToTick, snapTick, clampLoopRegion } from './clip-loop-brace';

describe('clip-loop-brace math', () => {
  it('pxToTick maps 0..width to 0..total', () => {
    expect(pxToTick(0, 200, 800)).toBe(0);
    expect(pxToTick(100, 200, 800)).toBe(400);
    expect(pxToTick(200, 200, 800)).toBe(800);
  });
  it('pxToTick clamps out-of-range px', () => {
    expect(pxToTick(-10, 200, 800)).toBe(0);
    expect(pxToTick(999, 200, 800)).toBe(800);
  });
  it('snapTick rounds to the nearest grid step', () => {
    expect(snapTick(50, 24)).toBe(48);
    expect(snapTick(60, 24)).toBe(72);
  });
  it('clampLoopRegion keeps start<end within 0..total and min one step', () => {
    expect(clampLoopRegion(100, 50, 800, 24)).toEqual({ start: 50, end: 100 }); // swaps
    expect(clampLoopRegion(0, 0, 800, 24)).toEqual({ start: 0, end: 24 });      // min width
    expect(clampLoopRegion(-10, 9000, 800, 24)).toEqual({ start: 0, end: 800 });
  });
});
