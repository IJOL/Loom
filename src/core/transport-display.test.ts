import { describe, it, expect } from 'vitest';
import { formatPosition } from './transport-display';

describe('transport formatPosition', () => {
  it('formats bar.beat.sub for 4/4 (16 steps/bar, 4 steps/beat)', () => {
    expect(formatPosition(0, 16, 4)).toBe('1.1.1');
    expect(formatPosition(4, 16, 4)).toBe('1.2.1');
    expect(formatPosition(16, 16, 4)).toBe('2.1.1');
  });

  it('formats bar.beat.sub for 7/8 (14 steps/bar, 2 steps/beat)', () => {
    expect(formatPosition(0, 14, 2)).toBe('1.1.1');
    expect(formatPosition(2, 14, 2)).toBe('1.2.1');
    expect(formatPosition(13, 14, 2)).toBe('1.7.2'); // last 16th of the bar
    expect(formatPosition(14, 14, 2)).toBe('2.1.1'); // next bar
  });
});
