import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { MasterCompressor } from './fx';

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

describe('MasterCompressor DSP', () => {
  it('inserted between source and destination, reduces RMS vs bypass', async () => {
    async function render(active: boolean): Promise<number> {
      const sr = 44100;
      const dur = 0.5;
      const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      amp.gain.value = 0.95;
      osc.frequency.value = 440;
      const mc = new MasterCompressor(ctx);
      mc.setState({ bypass: !active, threshold: -30, ratio: 8, attack: 0.001, release: 0.1, knee: 0, makeup: 1 });
      osc.connect(amp).connect(mc.input);
      mc.output.connect(ctx.destination);
      osc.start(0); osc.stop(dur);
      const r = await ctx.startRendering();
      return rms(r.getChannelData(0));
    }
    const bypassed = await render(false);
    const active   = await render(true);
    expect(active / bypassed).toBeLessThan(0.85);
  });
});
