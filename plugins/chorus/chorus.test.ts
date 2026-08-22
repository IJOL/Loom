// The plugin's own test, run against the plugin the way the host runs it: a
// two-line Loom double captures the factory, which is all main.ts asks of the
// ABI. That is the point — it proves this effect needs nothing from src/.
//
// The graph itself is the SDK's and is tested there. What is left to prove here
// is that THIS configuration of it is a working chorus.
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

const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

async function render(setup: (fx: FxInstance) => void, secs = 0.5): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * secs), 44100);
  const osc = ctx.createOscillator(); osc.frequency.value = 330; osc.type = 'sawtooth';
  const fx = create(ctx as unknown as AudioContext); setup(fx);
  osc.connect(fx.input); fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

describe('chorus', () => {
  it('at mix 0 it passes the dry signal (an audible sound)', async () => {
    const b = await render((fx) => fx.setBaseValue('mix', 0));
    expect(rms(b)).toBeGreaterThan(0.05);
  });

  it('wetting it changes the sound — the delayed copy interferes', async () => {
    const dry = await render((fx) => { fx.setBaseValue('mix', 0); });
    const wet = await render((fx) => { fx.setBaseValue('mix', 0.5); fx.setBaseValue('rate', 1); fx.setBaseValue('depth', 0.8); });
    let d = 0; for (let i = 0; i < dry.length; i++) d += Math.abs(dry[i] - wet[i]);
    expect(d / dry.length / Math.max(1e-9, rms(dry))).toBeGreaterThan(0.1);
  });

  it('stays bounded — no runaway feedback', async () => {
    const b = await render((fx) => { fx.setBaseValue('mix', 0.7); fx.setBaseValue('depth', 1); fx.setBaseValue('rate', 3); });
    let peak = 0; for (const v of b) { const a = Math.abs(v); if (a > peak) peak = a; }
    expect(peak).toBeLessThan(4);
    expect(Number.isFinite(peak)).toBe(true);
  });

  it('declares no feedback knob, because a chorus has no feedback path', () => {
    // The one thing that distinguishes its manifest from the flanger's.
    expect(manifest.components[0].params.map((p) => p.id)).toEqual(['rate', 'depth', 'mix']);
  });

  it('answers to every param its manifest declares', () => {
    const fx = create(new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 3);
    }
  });
});
