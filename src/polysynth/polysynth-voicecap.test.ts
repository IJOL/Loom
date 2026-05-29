import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { OfflineAudioContext } from 'node-web-audio-api';
import { PolySynth } from './polysynth';

describe('PolySynth.setMaxVoices', () => {
  it('caps the number of simultaneous voices', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(2);
    expect(ps.maxVoices).toBe(2);
  });

  it('clamps maxVoices to [1, 16]', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(0);
    expect(ps.maxVoices).toBe(1);
    ps.setMaxVoices(100);
    expect(ps.maxVoices).toBe(16);
  });

  it('a 3rd simultaneous trigger steals the oldest voice', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(2);
    // Trigger 3 notes that all overlap (1.0s gates starting at 0, 0.1, 0.2).
    ps.trigger(60, 0.0, 1.0);
    ps.trigger(64, 0.1, 1.0);
    ps.trigger(67, 0.2, 1.0);
    // After the 3rd trigger, only 2 voices remain active.
    expect(ps.activeVoiceCount()).toBe(2);
  });
});
