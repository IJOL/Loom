// The plugin's own test, run against the plugin the way the host runs it: a
// two-line Loom double captures the factory, which is all main.ts asks of the
// ABI. Assertions carried over from src/plugins/fx/compressor.test.ts, with the
// manifest half now read from plugin.json — the file the host actually obeys.
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

describe('compressor plugin', () => {
  it('declares the documented params, and the factory answers to every one', () => {
    expect(manifest.components[0].id).toBe('compressor');
    const ids = manifest.components[0].params.map((p) => p.id).sort();
    expect(ids).toEqual(['attack', 'knee', 'makeup', 'ratio', 'release', 'threshold']);
    // A knob the graph never reads is a control that does nothing, and the
    // manifest alone cannot catch that.
    const inst = create(new AudioContext());
    for (const p of manifest.components[0].params) {
      inst.setBaseValue(p.id, p.default);
      expect(inst.getBaseValue(p.id)).toBeCloseTo(p.default, 3);
    }
  });

  it('exposes its params as AudioParams and round-trips base values', () => {
    const inst = create(new AudioContext());
    inst.setBaseValue('ratio', 8);
    expect(inst.getBaseValue('ratio')).toBeCloseTo(8, 3);
    expect(inst.getAudioParams().has('threshold')).toBe(true);
    expect(inst.getAudioParams().has('makeup')).toBe(true);
  });
});

describe('compressor DSP', () => {
  it('reduces peak of a hot signal vs an uncompressed copy (relative)', async () => {
    const sr = 44100;
    const render = async (compress: boolean) => {
      const ctx = new OfflineAudioContext(1, sr, sr);
      const osc = ctx.createOscillator();
      const drive = ctx.createGain();
      drive.gain.value = 4; // hot input well above threshold
      osc.frequency.value = 200;
      let tail: AudioNode = drive;
      osc.connect(drive);
      if (compress) {
        const inst = create(ctx as unknown as AudioContext);
        inst.setBaseValue('threshold', -30);
        inst.setBaseValue('ratio', 20);
        inst.setBaseValue('makeup', 1);
        drive.connect(inst.input);
        tail = inst.output;
      }
      tail.connect(ctx.destination);
      osc.start();
      const buf = await ctx.startRendering();
      let peak = 0;
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      return peak;
    };
    const [dry, wet] = await Promise.all([render(false), render(true)]);
    expect(wet).toBeLessThan(dry);
  });
});
