// The synthetic impulse response is pure maths over a Float32Array pair — no
// AudioContext — so it is unit-testable. Assertions are relative (ratios and
// orderings), never absolute magnitudes: the point is that plate is BRIGHTER
// THAN hall, not that either hits some number.
import { describe, it, expect } from 'vitest';
import { generateReverbIR, REVERB_TYPES, type ReverbType } from './reverb-ir';
import { spectralCentroid, rms } from '../../../test/dsp-asserts';

const SR = 44100;

function ir(type: ReverbType, seconds = 2, decay = 3) {
  return generateReverbIR({ sampleRate: SR, seconds, decay, type });
}

/** Energy in a [from,to) fraction of the buffer. */
function bandEnergy(buf: Float32Array, from: number, to: number): number {
  const a = Math.floor(buf.length * from);
  const b = Math.floor(buf.length * to);
  return rms(buf.subarray(a, b));
}

describe('generateReverbIR — shape', () => {
  it('is exactly sampleRate · seconds long', () => {
    const { left, right } = ir('room', 1.5);
    expect(left.length).toBe(Math.ceil(SR * 1.5));
    expect(right.length).toBe(left.length);
  });

  it('is deterministic: the same request twice yields the identical buffer', () => {
    const a = ir('hall');
    const b = ir('hall');
    expect(Array.from(a.left.subarray(0, 512))).toEqual(Array.from(b.left.subarray(0, 512)));
  });

  it('decorrelates the two channels, or the reverb would collapse to mono', () => {
    const { left, right } = ir('hall');
    let identical = true;
    for (let i = 0; i < 4096; i++) {
      if (left[i] !== right[i]) { identical = false; break; }
    }
    expect(identical).toBe(false);
  });
});

describe('generateReverbIR — every type decays', () => {
  for (const type of REVERB_TYPES) {
    it(`${type}: the tail is quieter at the end than at the start`, () => {
      const { left } = ir(type);
      // Compare the head of the diffuse tail against its final quarter.
      expect(bandEnergy(left, 0.6, 0.8)).toBeLessThan(bandEnergy(left, 0.1, 0.3));
    });
  }
});

describe('generateReverbIR — the types differ in the way their names promise', () => {
  it('plate is brighter than hall', () => {
    expect(spectralCentroid(ir('plate').left, SR))
      .toBeGreaterThan(spectralCentroid(ir('hall').left, SR));
  });

  it('room is brighter than hall (a hall is the dark one)', () => {
    expect(spectralCentroid(ir('room').left, SR))
      .toBeGreaterThan(spectralCentroid(ir('hall').left, SR));
  });
});

describe('generateReverbIR — the decay knob shortens the tail', () => {
  it('a higher decay leaves less energy in the second half', () => {
    const slow = ir('hall', 3, 1);
    const fast = ir('hall', 3, 8);
    const slowRatio = bandEnergy(slow.left, 0.5, 1) / bandEnergy(slow.left, 0, 0.5);
    const fastRatio = bandEnergy(fast.left, 0.5, 1) / bandEnergy(fast.left, 0, 0.5);
    expect(fastRatio).toBeLessThan(slowRatio);
  });
});

describe('generateReverbIR — DC is blocked', () => {
  // A convolver fed a DC-offset IR pumps the whole mix. The DC-blocking pass is
  // what stops that, so assert the mean is negligible RELATIVE to the level.
  for (const type of REVERB_TYPES) {
    it(`${type}: mean offset is negligible against its own RMS`, () => {
      const { left } = ir(type);
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += left[i];
      const mean = Math.abs(sum / left.length);
      expect(mean).toBeLessThan(rms(left) * 0.01);
    });
  }
});
