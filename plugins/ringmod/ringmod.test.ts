// What a ring modulator IS: the carrier frequency replaces the input's own.
// A 440 Hz tone times a 300 Hz carrier becomes 140 and 740 — and crucially the
// 440 is GONE. That absence is the claim worth testing, and it is measured by
// correlating the output against the original tone rather than by eyeballing a
// spectrum.
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

/** How much of `hz` is present in a buffer, as a fraction of its total level.
 *  Correlation against a reference sine — 1 means "this IS that tone", 0 means
 *  "that tone is not in here". */
function shareOf(d: Float32Array, hz: number): number {
  let re = 0, im = 0, energy = 0;
  for (let i = 0; i < d.length; i++) {
    const t = (2 * Math.PI * hz * i) / SR;
    re += d[i] * Math.cos(t);
    im += d[i] * Math.sin(t);
    energy += d[i] * d[i];
  }
  const mag = Math.sqrt(re * re + im * im) / d.length;
  const rms = Math.sqrt(energy / d.length);
  return rms === 0 ? 0 : mag / rms;
}

async function render(set: Record<string, number> | null): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  if (set) {
    const fx = create(ctx as unknown as AudioContext);
    for (const [id, v] of Object.entries(set)) fx.setBaseValue(id, v);
    osc.connect(fx.input);
    fx.output.connect(ctx.destination);
  } else {
    osc.connect(ctx.destination);      // the control: the tone, untouched
  }
  osc.start();
  return (await ctx.startRendering()).getChannelData(0);
}

describe('ring modulator', () => {
  it('registers under the id its manifest declares', () => {
    expect(manifest.components[0].id).toBe('ringmod');
    expect(create).toBeTypeOf('function');
  });

  it('removes the carrier: the input tone is far weaker in the output than in the source', async () => {
    const through = shareOf(await render({ freq: 300, mix: 1 }), 440);
    const bare    = shareOf(await render(null), 440);
    // Relative to the untouched tone, which is what "removes" has to mean.
    expect(through).toBeLessThan(bare * 0.2);
  });

  it('puts the sum and difference where the original was', async () => {
    // 440 x 300 -> 140 and 740. Both must be present, and stronger than the
    // 440 that is supposed to have gone.
    const d = await render({ freq: 300, mix: 1 });
    const original = shareOf(d, 440);
    expect(shareOf(d, 140)).toBeGreaterThan(original);
    expect(shareOf(d, 740)).toBeGreaterThan(original);
  });

  it('the freq knob moves the sidebands', async () => {
    // A different carrier puts them somewhere else — which is what proves the
    // knob reaches the oscillator rather than just storing a number.
    const d = await render({ freq: 100, mix: 1 });
    expect(shareOf(d, 340)).toBeGreaterThan(shareOf(d, 140));
  });

  it('mix 0 hands back the dry signal', async () => {
    const dry  = await render({ freq: 300, mix: 0 });
    const bare = await render(null);
    expect(shareOf(dry, 440)).toBeCloseTo(shareOf(bare, 440), 2);
  });

  it('answers to every param its manifest declares, at a value it did NOT start on', () => {
    // Writing the manifest's own default proves nothing: every shadow variable
    // already holds it, so a setBaseValue that ignored the id entirely would
    // still read back correctly. A review proved that by deleting a knob's
    // branch from a copy of a sibling plugin and watching its suite stay green.
    const fx = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      const off = p.default === p.min ? p.max : p.min;
      fx.setBaseValue(p.id, off);
      expect(fx.getBaseValue(p.id), `${p.id} did not take the written value`).toBeCloseTo(off, 5);
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });

  it('exposes freq as a CENTS destination, not a hertz one', () => {
    // A modulator's depth is scaled by the declared range, and an undeclared one
    // falls back to 0..1 — so publishing carrier.frequency over a 20-4000 Hz
    // knob gave a full-depth LFO ±1 Hz out of 3980. If this ever comes back as
    // hertz, someone has "simplified" it and the destination is dead again.
    const fx = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    expect(fx.getAudioParamRange?.('freq')).toEqual({ min: 0, max: 4800 });
    expect(fx.getAudioParams().has('freq')).toBe(true);
  });
});
