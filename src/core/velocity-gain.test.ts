import { describe, it, expect } from 'vitest';
import { velNorm, velToGain, DEFAULT_VELOCITY, resolveVelocity, velGain } from './velocity-gain';

describe('velocity-gain', () => {
  it('velNorm maps 0..127 to 0..1, clamped', () => {
    expect(velNorm(0)).toBe(0);
    expect(velNorm(127)).toBe(1);
    expect(velNorm(-10)).toBe(0);
    expect(velNorm(999)).toBe(1);
  });

  it('velToGain is monotonic and reproduces the legacy non-accent/accent levels', () => {
    expect(velToGain(80)).toBeCloseTo(1.0, 1);   // legacy non-accent ≈ 1.0
    expect(velToGain(115)).toBeCloseTo(1.3, 1);  // legacy accent ≈ 1.3
    expect(velToGain(40)).toBeLessThan(velToGain(80));
    expect(velToGain(127)).toBeGreaterThan(velToGain(100));
  });

  it('has a non-zero floor so soft notes are quiet but audible', () => {
    expect(velToGain(0)).toBeGreaterThan(0.2);
    expect(velToGain(0)).toBeLessThan(0.4);
  });

  it('resolveVelocity falls back to a sensible default when undefined', () => {
    expect(resolveVelocity(undefined, false)).toBe(DEFAULT_VELOCITY);
    expect(resolveVelocity(undefined, true)).toBeGreaterThanOrEqual(100); // accent default ≥ threshold
    expect(resolveVelocity(50, false)).toBe(50);
  });

  it('velGain adds an accent punch on top of the velocity curve', () => {
    // same velocity, accent louder than non-accent
    expect(velGain(110, true)).toBeGreaterThan(velGain(110, false));
    // non-accent path equals the plain velocity curve
    expect(velGain(80, false)).toBeCloseTo(velToGain(80), 5);
    // accented note is clearly louder than a normal (non-accent) note at the default velocity
    expect(velGain(115, true)).toBeGreaterThan(velGain(90, false) * 1.2);
  });
});
