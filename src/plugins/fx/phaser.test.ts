// Phaser: a chain of all-pass filters whose corner frequencies an LFO sweeps,
// mixed with the dry signal so the moving notches whoosh. Native Web Audio
// (BiquadFilter allpass stages + an LFO), rendered through OfflineAudioContext.
import { describe, it, expect } from 'vitest';
import { phaserPlugin } from './phaser';
import type { PluginFactory } from '../types';

const mk = (ctx: BaseAudioContext) => phaserPlugin.kind === 'fx' ? phaserPlugin.create(ctx as unknown as AudioContext) : null!;

async function render(setup: (fx: ReturnType<typeof mk>) => void, secs = 0.5): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * secs), 44100);
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
  const fx = mk(ctx); setup(fx);
  osc.connect(fx.input); fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0);
}
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('phaser', () => {
  it('at mix 0 it passes the dry signal', async () => {
    const b = await render((fx) => fx.setBaseValue('mix', 0));
    expect(rms(b)).toBeGreaterThan(0.05);
  });

  it('wetting it moves notches through the sound — the output changes', async () => {
    const dry = await render((fx) => fx.setBaseValue('mix', 0));
    const wet = await render((fx) => { fx.setBaseValue('mix', 0.7); fx.setBaseValue('rate', 1); fx.setBaseValue('depth', 0.9); });
    let d = 0; for (let i = 0; i < dry.length; i++) d += Math.abs(dry[i] - wet[i]);
    expect(d / dry.length / Math.max(1e-9, rms(dry))).toBeGreaterThan(0.1);
  });

  it('stays bounded with feedback up', async () => {
    const b = await render((fx) => { fx.setBaseValue('mix', 0.7); fx.setBaseValue('feedback', 1); fx.setBaseValue('depth', 1); fx.setBaseValue('rate', 4); });
    let peak = 0; for (const v of b) { const a = Math.abs(v); if (a > peak) peak = a; }
    expect(peak).toBeLessThan(4);
    expect(Number.isFinite(peak)).toBe(true);
  });

  it('round-trips its params', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const fx = mk(ctx);
    fx.setBaseValue('rate', 1.5); fx.setBaseValue('depth', 0.5); fx.setBaseValue('feedback', 0.3); fx.setBaseValue('mix', 0.55);
    expect(fx.getBaseValue('rate')).toBeCloseTo(1.5, 3);
    expect(fx.getBaseValue('depth')).toBeCloseTo(0.5, 3);
    expect(fx.getBaseValue('feedback')).toBeCloseTo(0.3, 3);
    expect(fx.getBaseValue('mix')).toBeCloseTo(0.55, 3);
  });
});
