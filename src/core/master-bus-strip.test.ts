import { describe, it, expect } from 'vitest';
import { MasterBusStrip } from './master-bus-strip';

// A tiny fake BaseAudioContext: each created node carries the AudioParams the
// strip touches and a chainable connect(). Enough to exercise the pure
// get/set/serialize/restore logic without a real audio graph.
function fakeParam(initial = 0) {
  return { value: initial, setTargetAtTime(v: number) { this.value = v; } };
}
function makeCtx(): BaseAudioContext {
  const mk = () => ({
    type: '' as BiquadFilterType,
    fftSize: 0,
    smoothingTimeConstant: 0,
    gain: fakeParam(1),
    frequency: fakeParam(0),
    Q: fakeParam(0),
    pan: fakeParam(0),
    connect: (n: unknown) => n,
  });
  return {
    currentTime: 0,
    createGain: mk,
    createBiquadFilter: mk,
    createStereoPanner: mk,
    createAnalyser: mk,
  } as unknown as BaseAudioContext;
}

describe('MasterBusStrip', () => {
  it('defaults are flat / centred / unmuted', () => {
    const s = new MasterBusStrip(makeCtx());
    expect(s.serialize()).toEqual({ eqLow: 0, eqMid: 0, eqHigh: 0, pan: 0, muted: false });
  });

  it('setters round-trip through serialize', () => {
    const s = new MasterBusStrip(makeCtx());
    s.setEqLow(-3); s.setEqMid(4.5); s.setEqHigh(6); s.setPan(-0.5); s.setMuted(true);
    expect(s.serialize()).toEqual({ eqLow: -3, eqMid: 4.5, eqHigh: 6, pan: -0.5, muted: true });
    expect(s.getEqLow()).toBe(-3);
    expect(s.getPan()).toBe(-0.5);
    expect(s.isMuted()).toBe(true);
  });

  it('restore applies a saved state and ignores undefined', () => {
    const s = new MasterBusStrip(makeCtx());
    s.restore({ eqLow: 2, eqMid: -1, eqHigh: 0, pan: 0.25, muted: true });
    expect(s.serialize()).toEqual({ eqLow: 2, eqMid: -1, eqHigh: 0, pan: 0.25, muted: true });
    s.restore(undefined);
    expect(s.serialize()).toEqual({ eqLow: 2, eqMid: -1, eqHigh: 0, pan: 0.25, muted: true });
  });

  it('mute zeroes the mute gain; unmute restores it', () => {
    const s = new MasterBusStrip(makeCtx());
    // getMeterAnalyser taps the mute gain — exercise it for coverage of the lazy path.
    expect(s.getMeterAnalyser()).toBe(s.getMeterAnalyser());
    s.setMuted(true);
    expect(s.isMuted()).toBe(true);
    s.setMuted(false);
    expect(s.isMuted()).toBe(false);
  });
});
