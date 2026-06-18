import { describe, it, expect } from 'vitest';
import { limiterPlugin } from './limiter';

describe('limiter plugin', () => {
  it('has fx manifest with ceiling + release', () => {
    expect(limiterPlugin.kind).toBe('fx');
    if (limiterPlugin.kind !== 'fx') throw new Error('expected fx plugin');
    expect(limiterPlugin.manifest.id).toBe('limiter');
    const ids = limiterPlugin.manifest.params.map((p) => p.id).sort();
    expect(ids).toEqual(['ceiling', 'release']);
  });

  it('caps output peak below an over-ceiling input (relative)', async () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, sr, sr);
    const osc = ctx.createOscillator();
    const drive = ctx.createGain();
    drive.gain.value = 6; // way over ceiling
    osc.frequency.value = 200;
    const inst = limiterPlugin.kind === 'fx' ? limiterPlugin.create(ctx as unknown as AudioContext) : null!;
    inst.setBaseValue('ceiling', -6);
    osc.connect(drive).connect(inst.input);
    inst.output.connect(ctx.destination);
    osc.start();
    const buf = await ctx.startRendering();
    let peak = 0;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    // -6 dBFS ≈ 0.5 linear; allow the compressor's soft overshoot but require
    // it well under the 6× drive. Relative ceiling check, not an absolute spec.
    expect(peak).toBeLessThan(1.0);
    expect(peak).toBeLessThan(drive.gain.value);
  });
});
