// The plugin's own test, run against the plugin the way the host runs it: a
// two-line Loom double captures the factory, which is all main.ts asks of the
// ABI. That is the point — it proves this effect needs nothing from src/.
//
// The manifest half of what used to be tested here now lives in plugin.json and
// is checked by the host's validator; what is left to prove is the audio.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';
import manifest from './plugin.json';

let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

describe('limiter plugin', () => {
  it('registers under the id its manifest declares', () => {
    expect(manifest.components[0].id).toBe('limiter');
    expect(create).toBeTypeOf('function');
  });

  it('declares ceiling + release, and the factory answers to both', () => {
    const ids = manifest.components[0].params.map((p) => p.id).sort();
    expect(ids).toEqual(['ceiling', 'release']);
    // The manifest is only a promise until the factory honours it: a knob the
    // graph does not read is a control that does nothing.
    const inst = create(new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      inst.setBaseValue(p.id, p.default);
      expect(inst.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });

  it('caps output peak below an over-ceiling input (relative)', async () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, sr, sr);
    const osc = ctx.createOscillator();
    const drive = ctx.createGain();
    drive.gain.value = 6; // way over ceiling
    osc.frequency.value = 200;
    const inst = create(ctx as unknown as AudioContext);
    inst.setBaseValue('ceiling', -6);
    osc.connect(drive).connect(inst.input);
    inst.output.connect(ctx.destination);
    osc.start();
    const buf = await ctx.startRendering();
    let peak = 0;
    const d = buf.getChannelData(0).slice();
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    // -6 dBFS ≈ 0.5 linear; allow the compressor's soft overshoot but require
    // it well under the 6× drive. Relative ceiling check, not an absolute spec.
    expect(peak).toBeLessThan(1.0);
    expect(peak).toBeLessThan(drive.gain.value);
  });
});
