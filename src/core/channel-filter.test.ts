import { describe, it, expect } from 'vitest';
import '../../test/setup';
import {
  ChannelFilter,
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX,
  FILTER_Q_MIN, FILTER_Q_MAX,
  FILTER_DETUNE_SPAN_CENTS,
} from './channel-filter';

describe('ChannelFilter constants', () => {
  it('spans 20 Hz..20 kHz cutoff and 0.7..18 Q', () => {
    expect(FILTER_CUTOFF_MIN).toBe(20);
    expect(FILTER_CUTOFF_MAX).toBe(20000);
    expect(FILTER_Q_MIN).toBeCloseTo(0.7, 5);
    expect(FILTER_Q_MAX).toBe(18);
  });

  it('the modulation cents span is the full 20Hz..20kHz exponential sweep', () => {
    expect(FILTER_DETUNE_SPAN_CENTS).toBeCloseTo(1200 * Math.log2(20000 / 20), 0);
  });
});

describe('ChannelFilter node', () => {
  it('is a lowpass with the default cutoff fully open and minimum Q', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    expect(cf.node.type).toBe('lowpass');
    expect(cf.node.frequency.value).toBeCloseTo(20000, 0);
    expect(cf.node.Q.value).toBeCloseTo(0.7, 5);
  });

  it('input feeds the biquad and output is the biquad (raw mix passes through it)', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    expect(cf.input).toBeDefined();
    expect(cf.output).toBe(cf.node);
  });

  it('setCutoff/setResonance write the BiquadFilter params; getters read them back', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    cf.setCutoff(800);
    cf.setResonance(6);
    expect(cf.node.frequency.value).toBeCloseTo(800, 3);
    expect(cf.node.Q.value).toBeCloseTo(6, 3);
    expect(cf.getCutoff()).toBeCloseTo(800, 3);
    expect(cf.getResonance()).toBeCloseTo(6, 3);
  });

  it('exposes frequency (knob path), detune (cutoff mod), and Q (res mod) AudioParams', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    expect(cf.getCutoffModParam()).toBe(cf.node.detune);
    expect(cf.getResonanceParam()).toBe(cf.node.Q);
  });
});
