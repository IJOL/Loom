import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { OfflineAudioContext } from 'node-web-audio-api';
import { PolySynth } from './polysynth';

describe('PolySynth.modBus', () => {
  it('exposes modBus AudioParams keyed by canonical paramId', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    expect(ps.modBus['filter.cutoff']).toBeDefined();
    expect(ps.modBus['filter.resonance']).toBeDefined();
    expect(ps.modBus['amp.gain']).toBeDefined();
    expect(ps.modBus['filter.cutoff'].offset).toBeInstanceOf(AudioParam);
  });

  it('writing to modBus.filter.cutoff.offset renders without throwing', async () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.trigger(60, 0, 0.5);
    ps.modBus['filter.cutoff'].offset.setValueAtTime(-2000, 0);
    ps.modBus['filter.cutoff'].offset.linearRampToValueAtTime(2000, 0.5);
    const out = await (ctx as unknown as OfflineAudioContext).startRendering();
    expect(out.length).toBeGreaterThan(0);
  });
});
