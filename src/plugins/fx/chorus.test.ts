// Chorus and flanger are the same shape — a delay line whose time an LFO wobbles,
// mixed back with the dry signal — differing only in delay length and feedback.
// Both are native Web Audio (DelayNode), like reverb/delay, not a worklet.
import { describe, it, expect } from 'vitest';
import { chorusPlugin } from './chorus';
import { flangerPlugin } from './flanger';
import type { PluginFactory } from '../types';

const mk = (p: PluginFactory, ctx: BaseAudioContext) => p.kind === 'fx' ? p.create(ctx as unknown as AudioContext) : null!;

async function render(p: PluginFactory, setup: (fx: ReturnType<typeof mk>) => void, secs = 0.5): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * secs), 44100);
  const osc = ctx.createOscillator(); osc.frequency.value = 330; osc.type = 'sawtooth';
  const fx = mk(p, ctx); setup(fx);
  osc.connect(fx.input); fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0);
}
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

for (const [name, plugin] of [['chorus', chorusPlugin], ['flanger', flangerPlugin]] as const) {
  describe(name, () => {
    it('at mix 0 it passes the dry signal (an audible sound)', async () => {
      const b = await render(plugin, (fx) => fx.setBaseValue('mix', 0));
      expect(rms(b)).toBeGreaterThan(0.05);
    });

    it('wetting it changes the sound — the delayed copy interferes', async () => {
      const dry = await render(plugin, (fx) => { fx.setBaseValue('mix', 0); });
      const wet = await render(plugin, (fx) => { fx.setBaseValue('mix', 0.5); fx.setBaseValue('rate', 1); fx.setBaseValue('depth', 0.8); });
      let d = 0; for (let i = 0; i < dry.length; i++) d += Math.abs(dry[i] - wet[i]);
      expect(d / dry.length / Math.max(1e-9, rms(dry))).toBeGreaterThan(0.1);
    });

    it('stays bounded — no runaway feedback', async () => {
      const b = await render(plugin, (fx) => { fx.setBaseValue('mix', 0.7); fx.setBaseValue('depth', 1); fx.setBaseValue('rate', 3); });
      let peak = 0; for (const v of b) { const a = Math.abs(v); if (a > peak) peak = a; }
      expect(peak).toBeLessThan(4);
      expect(Number.isFinite(peak)).toBe(true);
    });

    it('round-trips its params', () => {
      const ctx = new OfflineAudioContext(1, 4410, 44100);
      const fx = mk(plugin, ctx);
      fx.setBaseValue('rate', 2.5); fx.setBaseValue('depth', 0.4); fx.setBaseValue('mix', 0.6);
      expect(fx.getBaseValue('rate')).toBeCloseTo(2.5, 3);
      expect(fx.getBaseValue('depth')).toBeCloseTo(0.4, 3);
      expect(fx.getBaseValue('mix')).toBeCloseTo(0.6, 3);
    });
  });
}

describe('chorus vs flanger differ', () => {
  it('the flanger, with feedback, sounds different from the chorus at the same settings', async () => {
    const setup = (fx: ReturnType<typeof mk>) => { fx.setBaseValue('mix', 0.6); fx.setBaseValue('rate', 1); fx.setBaseValue('depth', 0.7); };
    const c = await render(chorusPlugin, setup);
    const f = await render(flangerPlugin, setup);
    let d = 0; for (let i = 0; i < c.length; i++) d += Math.abs(c[i] - f[i]);
    expect(d / c.length / Math.max(1e-9, rms(c))).toBeGreaterThan(0.05);
  });
});
