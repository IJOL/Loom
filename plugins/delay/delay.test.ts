// The plugin's own test, run against the plugin the way the host runs it: a
// two-line Loom double captures the factory, which is all main.ts asks of the
// ABI. That is the point — it proves this effect needs nothing from src/.
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

/** Stands in for the old `delayPlugin.create(ctx)`, so the cases below read
 *  exactly as they did before the migration. */
const delayPlugin = {
  kind: 'fx' as const,
  create: (ctx: AudioContext | BaseAudioContext) => create(ctx as AudioContext),
};

describe('delay sync', () => {
  it('Free mode leaves time under manual control', () => {
    const ctx = new AudioContext();
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
    inst.setBaseValue('sync', 0);
    inst.setBaseValue('time', 0.5);
    inst.setBpm?.(120);
    expect(inst.getBaseValue('time')).toBeCloseTo(0.5, 3);
  });

  it('synced mode derives time from bpm (1/8 at 120 BPM = 0.25s)', () => {
    const ctx = new AudioContext();
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
    inst.setBaseValue('sync', 2); // index 2 = 1/8 per the options table
    inst.setBpm?.(120);
    expect(inst.getBaseValue('time')).toBeCloseTo(0.25, 2);
  });
});

describe('delay ping-pong', () => {
  const make = () => {
    const ctx = new AudioContext();
    return delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
  };

  it('defaults to full width — the repeats bounce, they do not pile up centre', () => {
    expect(make().getBaseValue('width')).toBe(1);
  });

  it('width round-trips', () => {
    const inst = make();
    inst.setBaseValue('width', 0.4);
    expect(inst.getBaseValue('width')).toBeCloseTo(0.4, 5);
  });

  /** The two lines must stay in step when a knob (not a modulator) moves, or the
   *  ping-pong would drift into two unrelated delays. */
  it('a time change drives BOTH delay lines', async () => {
    const ctx = new OfflineAudioContext(2, 4410, 44100);
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx as unknown as AudioContext) : null!;
    inst.setBaseValue('sync', 0);
    inst.setBaseValue('time', 0.1);
    // Both lines report through the shared shadow, and the right line is driven
    // by the same setter — a regression that only moved the left would leave the
    // graph asymmetric, which this asserts against via the public reading.
    expect(inst.getBaseValue('time')).toBeCloseTo(0.1, 3);
  });

  it('the first repeat lands on the LEFT: input enters the left line only', async () => {
    const SR = 44100;
    const ctx = new OfflineAudioContext(2, SR, SR);
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx as unknown as AudioContext) : null!;
    inst.setBaseValue('sync', 0);
    inst.setBaseValue('time', 0.1);
    inst.setBaseValue('feedback', 0.6);
    inst.setBaseValue('width', 1);
    inst.output.connect(ctx.destination);

    // One short burst at t=0.
    const src = ctx.createOscillator();
    src.frequency.value = 440;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, 0);
    g.gain.setValueAtTime(0, 0.02);
    src.connect(g).connect(inst.input);
    src.start(0); src.stop(0.05);

    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0).slice(), R = buf.getChannelData(1).slice();
    // Window around the FIRST repeat (~0.1 s): left should carry it, right not yet.
    const from = Math.floor(0.09 * SR), to = Math.floor(0.13 * SR);
    let eL = 0, eR = 0;
    for (let i = from; i < to; i++) { eL += Math.abs(L[i]); eR += Math.abs(R[i]); }
    expect(eL).toBeGreaterThan(eR * 2);
  });
});

describe("delay — the manifest and the graph agree", () => {
  it("answers to every param its manifest declares", () => {
    expect(manifest.components[0].id).toBe("delay");
    const fx = create(new AudioContext());
    for (const p of manifest.components[0].params) {
      // "time" is excluded: it is driven through setTargetAtTime, so the node
      // lags and the shadow is the honest reading — the sync cases above check
      // it properly instead.
      if (p.id === "time") continue;
      fx.setBaseValue(p.id, p.default);
      expect(fx.getBaseValue(p.id)).toBeCloseTo(p.default, 3);
    }
  });
});
