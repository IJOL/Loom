// What an auto-wah IS: the filter opens further when you play harder. Every
// case below compares two renders of the SAME signal at different levels, so
// what is being measured is the response to loudness and not the loudness.
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

/** Brightness, normalised: the spectral centroid of the output. A filter opened
 *  further passes more of the harmonics above its corner, which lifts it. */
function centroid(d: Float32Array): number {
  // Zero crossings stand in for the centroid: they cost one pass and rise with
  // high-frequency content, which is all this needs to compare two renders.
  let cross = 0;
  for (let i = 1; i < d.length; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
  return cross;
}

/** A sawtooth at `level` through the effect, with `set` applied first. */
async function render(level: number, set: Record<string, number> = {}): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 110;
  const amp = ctx.createGain();
  amp.gain.value = level;
  const fx = create(ctx as unknown as AudioContext);
  for (const [id, v] of Object.entries(set)) fx.setBaseValue(id, v);
  osc.connect(amp).connect(fx.input);
  fx.output.connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

describe('auto-wah', () => {
  it('registers under the id its manifest declares', () => {
    expect(manifest.components[0].id).toBe('autowah');
    expect(create).toBeTypeOf('function');
  });

  it('opens the filter further for a louder input — the whole point', async () => {
    const loud  = centroid(await render(0.9,  { sens: 1 }));
    const quiet = centroid(await render(0.05, { sens: 1 }));
    expect(loud).toBeGreaterThan(quiet);
  });

  it('sens 0 makes it a plain fixed filter, whatever the level', async () => {
    // The control for the case above: with no sensitivity the follower's
    // output is scaled to nothing, so loud and quiet must land alike.
    const loud  = centroid(await render(0.9,  { sens: 0 }));
    const quiet = centroid(await render(0.05, { sens: 0 }));
    // Relative: within a few percent of each other, versus the clear gap above.
    expect(Math.abs(loud - quiet)).toBeLessThan(loud * 0.05);
  });

  it('range scales how far the sweep travels', async () => {
    const wide   = centroid(await render(0.9, { sens: 1, range: 4800 }));
    const narrow = centroid(await render(0.9, { sens: 1, range: 300 }));
    expect(wide).toBeGreaterThan(narrow);
  });

  it('mix 0 hands back the dry signal', async () => {
    const dry = await render(0.9, { mix: 0, sens: 1 });
    const ctx = new OfflineAudioContext(1, SR, SR);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 110;
    const amp = ctx.createGain(); amp.gain.value = 0.9;
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    const bare = (await ctx.startRendering()).getChannelData(0).slice();
    expect(centroid(dry)).toBe(centroid(bare));
  });

  it('answers to every param its manifest declares, at a value it did NOT start on', () => {
    // Writing the manifest's own default proves nothing: every shadow variable
    // already holds it, so a setBaseValue that ignored the id entirely would
    // still read back correctly. A review proved that on THIS plugin — it
    // deleted the `range` branch and the whole suite stayed green, while writing
    // 1234 read back 2400.
    const fx = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    for (const p of manifest.components[0].params) {
      const off = p.default === p.min ? p.max : p.min;
      fx.setBaseValue(p.id, off);
      expect(fx.getBaseValue(p.id), `${p.id} did not take the written value`).toBeCloseTo(off, 5);
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 5);
    }
  });

  it('exposes base as a CENTS destination, not a hertz one', () => {
    // The rule this effect is built on: a modulator summed onto frequency in Hz
    // is inaudible anywhere but the bottom of the range. If this span ever
    // comes back as 0..2000, someone has "simplified" it to hertz.
    const fx = create(new OfflineAudioContext(1, 128, SR) as unknown as AudioContext);
    expect(fx.getAudioParamRange?.('base')).toEqual({ min: 0, max: 4800 });
    expect(fx.getAudioParams().has('base')).toBe(true);
  });
});
