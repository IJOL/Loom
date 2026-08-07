// The reverb had NO test of its own in the tree — only its impulse response
// did, and that moved to the SDK with the maths. What was never covered is the
// GRAPH around it: that the convolver is actually in the path, that the wet
// gain reaches it, and that the three knobs which force an IR rebuild really
// change the sound rather than just the stored number.
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

const SR = 44100;
const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

/** One short click, then silence — so everything after the click IS the tail. */
async function renderTail(setup: (fx: FxInstance) => void): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const fx = create(ctx as unknown as AudioContext);
  setup(fx);
  const src = ctx.createOscillator();
  src.frequency.value = 440;
  const g = ctx.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.setValueAtTime(0, 0.02);          // 20 ms burst
  src.connect(g).connect(fx.input);
  fx.output.connect(ctx.destination);
  src.start(); src.stop(0.05);
  const out = await ctx.startRendering();
  return out.getChannelData(0).subarray(Math.floor(SR * 0.1));   // past the burst
}

describe('reverb plugin', () => {
  it('registers under the id its manifest declares', () => {
    expect(manifest.components[0].id).toBe('reverb');
    expect(create).toBeTypeOf('function');
  });

  it('rings on after the source stops — that is what a reverb IS', async () => {
    const tail = await renderTail((fx) => { fx.setBaseValue('wet', 1); fx.setBaseValue('size', 3); });
    expect(rms(tail)).toBeGreaterThan(0);
  });

  it('wet 0 leaves no tail at all', async () => {
    // The control for the case above: same graph, same burst, nothing through.
    const loud = await renderTail((fx) => { fx.setBaseValue('wet', 1); fx.setBaseValue('size', 3); });
    const off  = await renderTail((fx) => { fx.setBaseValue('wet', 0); fx.setBaseValue('size', 3); });
    expect(rms(off)).toBeLessThan(rms(loud) * 0.01);
  });

  it('a bigger size leaves more energy late in the tail', async () => {
    // Relative to each other, never to a magnitude: what "bigger" means is
    // more of the tail surviving to the same point in time.
    const small = await renderTail((fx) => { fx.setBaseValue('wet', 1); fx.setBaseValue('size', 0.3); });
    const big   = await renderTail((fx) => { fx.setBaseValue('wet', 1); fx.setBaseValue('size', 6); });
    const late = (b: Float32Array) => rms(b.subarray(Math.floor(b.length * 0.5)));
    expect(late(big)).toBeGreaterThan(late(small));
  });

  it('the type knob really rebuilds the IR: a plate is not a hall', async () => {
    // The three rebuild knobs guard on "did the value change", so a knob that
    // stored its number without rebuilding would look identical here.
    const hall  = await renderTail((fx) => { fx.setBaseValue('wet', 1); fx.setBaseValue('type', 1); });
    const plate = await renderTail((fx) => { fx.setBaseValue('wet', 1); fx.setBaseValue('type', 2); });
    let d = 0;
    for (let i = 0; i < hall.length; i++) d += Math.abs(hall[i] - plate[i]);
    expect(d / hall.length).toBeGreaterThan(0);
  });

  it('answers to every param its manifest declares', () => {
    const fx = create(new OfflineAudioContext(2, 4410, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      // 'predelay' is excluded: it is driven through setTargetAtTime, so the
      // node lags and reading it straight back would measure the ramp.
      if (p.id === 'predelay') continue;
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 3);
    }
  });
});
