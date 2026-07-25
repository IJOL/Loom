import { describe, it, expect } from 'vitest';
import {
  velNorm, velToGain, DEFAULT_VELOCITY, resolveVelocity, velGain,
  velGain01, ACCENT_PUNCH, ACCENT_VCA_LADDER,
} from './velocity-gain';

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

  it('velGain01 agrees with velGain over the MIDI domain', () => {
    // The 0..1 sibling exists because NoteSpec.velocity is already normalised.
    // It must be the SAME curve, not a second one: assert the RATIO of the two
    // spellings is 1 for every velocity the app can send, accented or not.
    for (const v of [0, 1, 40, 64, 80, 90, 100, 115, 127]) {
      for (const accent of [false, true]) {
        expect(velGain01(velNorm(v), accent) / velGain(v, accent)).toBeCloseTo(1, 12);
      }
    }
  });

  it('velGain01 clamps velocities outside 0..1 instead of extrapolating', () => {
    // The seam (worklet-lane-engine) already clamps via velNorm, but a renderer
    // must never be able to run away above full scale.
    expect(velGain01(1.5, false) / velGain01(1, false)).toBeCloseTo(1, 12);
    expect(velGain01(-0.5, false) / velGain01(0, false)).toBeCloseTo(1, 12);
  });

  it('the ladder accent punch is a bigger punch than the shared one', () => {
    // Ratio, not dB: the TB-303's diode ladder loses level as accent raises Q,
    // so its VCA punch has to be larger to still read as an accent.
    expect(ACCENT_VCA_LADDER / ACCENT_PUNCH).toBeGreaterThan(1);
    // ...and an engine that opts into it is louder on accent than one that doesn't.
    expect(velGain01(0.8, true, ACCENT_VCA_LADDER)).toBeGreaterThan(velGain01(0.8, true));
  });
});
