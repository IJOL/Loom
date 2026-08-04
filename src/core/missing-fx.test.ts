import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMissingFx, isMissingFx, __resetMissingFxWarnings } from './missing-fx';

describe('missing fx placeholder', () => {
  beforeEach(() => __resetMissingFxWarnings());

  it('passes audio through untouched', async () => {
    const ctx = new OfflineAudioContext(1, 4096, 44100);
    const src = ctx.createConstantSource();
    src.offset.value = 0.5;
    const fx = createMissingFx(ctx as unknown as AudioContext, 'delay', {});
    src.connect(fx.input);
    fx.output.connect(ctx.destination);
    src.start();
    const buf = await ctx.startRendering();
    const tail = buf.getChannelData(0).slice(2048);
    // Relative: the placeholder must not attenuate. Compare against the source
    // level rather than an absolute figure.
    expect(Math.min(...tail)).toBeGreaterThan(0.5 * 0.99);
  });

  it('hands back the params it was given, so a save round-trips them', () => {
    const ctx = new AudioContext();
    const fx = createMissingFx(ctx, 'delay', { time: 0.375, feedback: 0.4 });
    expect(fx.getBaseValue('time')).toBe(0.375);
    fx.setBaseValue('time', 0.5);
    expect(fx.getBaseValue('time')).toBe(0.5);
    expect(isMissingFx(fx)).toBe(true);
  });

  it('warns once per missing id, not once per slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = new AudioContext();
    createMissingFx(ctx, 'delay', {});
    createMissingFx(ctx, 'delay', {});
    createMissingFx(ctx, 'reverb', {});
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('delay'))).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('reverb'))).toHaveLength(1);
    warn.mockRestore();
  });
});
