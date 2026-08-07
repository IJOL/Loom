// The flanger had NO test of its own in the tree — it rode along on the
// chorus's, which covered both through a shared loop. Splitting them per plugin
// is what "drop-in" means, so it gets its own here, including the one thing the
// chorus cannot have: a feedback path.
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
  return (await ctx.startRendering()).getChannelData(0);
}

describe('flanger', () => {
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

  it('does not run away at full feedback: the level settles instead of growing', async () => {
    // "Bounded" measured as a SHAPE, not a magnitude. A runaway comb grows
    // without limit, so its second half is louder than its first; a stable one
    // reaches its resonance and stays there. Comparing the two halves says
    // which of those is happening without inventing a threshold.
    //
    // Worth knowing what the magnitude actually is, because a threshold would
    // have hidden it: at feedback 1 (a 0.9 ceiling) this peaks around 5.5x the
    // input. That is not instability — a comb with gain g resonates at
    // 1/(1-g) = 10 — but it IS loud enough to clip the master on its own, and
    // nothing in the rack warns about it. See the gain-staging note in the spec.
    const b = await render((fx) => {
      fx.setBaseValue('mix', 0.7); fx.setBaseValue('depth', 1);
      fx.setBaseValue('rate', 3); fx.setBaseValue('feedback', 1);
    }, 2);
    const peakOf = (s: Float32Array) => { let p = 0; for (const v of s) { const a = Math.abs(v); if (a > p) p = a; } return p; };
    const half = Math.floor(b.length / 2);
    const first = peakOf(b.subarray(0, half));
    const second = peakOf(b.subarray(half));
    expect(Number.isFinite(second)).toBe(true);
    expect(second).toBeLessThan(first * 1.1);
  });

  it('feedback is what a flanger has and a chorus does not', async () => {
    // Measured on the tail after the source stops: a feedback path is the delay
    // line feeding itself, so energy survives the input. Relative to the same
    // graph with feedback at zero, never to a magnitude.
    const tail = async (feedback: number) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const fx = create(ctx as unknown as AudioContext);
      fx.setBaseValue('depth', 1); fx.setBaseValue('mix', 1); fx.setBaseValue('feedback', feedback);
      const osc = ctx.createOscillator(); osc.frequency.value = 330;
      osc.connect(fx.input); fx.output.connect(ctx.destination);
      osc.start(); osc.stop(0.5);
      return rms((await ctx.startRendering()).getChannelData(0).subarray(Math.floor(44100 * 0.55)));
    };
    expect(await tail(0.9)).toBeGreaterThan(await tail(0) * 2);
  });

  it('answers to every param its manifest declares, feedback included', () => {
    expect(manifest.components[0].params.map((p) => p.id)).toEqual(['rate', 'depth', 'feedback', 'mix']);
    const fx = create(new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 3);
    }
  });
});
