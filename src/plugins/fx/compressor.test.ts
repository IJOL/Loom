import { describe, it, expect } from 'vitest';
import { compressorPlugin } from './compressor';

describe('compressor plugin', () => {
  it('has fx manifest with the documented params', () => {
    expect(compressorPlugin.kind).toBe('fx');
    if (compressorPlugin.kind !== 'fx') throw new Error('expected fx plugin');
    expect(compressorPlugin.manifest.id).toBe('compressor');
    const ids = compressorPlugin.manifest.params.map((p) => p.id).sort();
    expect(ids).toEqual(['attack', 'knee', 'makeup', 'ratio', 'release', 'threshold']);
  });

  it('exposes its params as AudioParams and round-trips base values', () => {
    const ctx = new AudioContext();
    const inst = compressorPlugin.kind === 'fx' ? compressorPlugin.create(ctx) : null!;
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
        const inst = compressorPlugin.kind === 'fx' ? compressorPlugin.create(ctx as unknown as AudioContext) : null!;
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
