import { describe, it, expect } from 'vitest';
import { SendBus } from './send-bus';

describe('SendBus', () => {
  it('routes input → inserts → returnLevel → output and respects mute', async () => {
    const sr = 44100;
    const renderReturn = async (muted: boolean) => {
      const ctx = new OfflineAudioContext(1, sr, sr);
      const out = ctx.createGain();
      out.connect(ctx.destination);
      const bus = new SendBus(ctx as unknown as AudioContext, 'A', 'Send A', out);
      bus.setReturnLevel(1);
      bus.setMuted(muted);
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(bus.input);
      osc.start();
      const buf = await ctx.startRendering();
      let peak = 0;
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      return peak;
    };
    const [open, muted] = await Promise.all([renderReturn(false), renderReturn(true)]);
    expect(open).toBeGreaterThan(0.01);
    expect(muted).toBeLessThan(open * 0.01);
  });

  it('restores signal after mute→unmute round-trip (insert chain stays connected)', async () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, sr, sr);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const bus = new SendBus(ctx as unknown as AudioContext, 'C', 'Send C', out);
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    osc.connect(bus.input);
    osc.start();

    // Set level, mute, unmute before rendering
    bus.setReturnLevel(1);
    bus.setMuted(true);
    bus.setMuted(false);

    const buf = await ctx.startRendering();
    let peak = 0;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));

    // Peak should be non-trivial, proving the insert chain was NOT torn down
    expect(peak).toBeGreaterThan(0.01);
  });

  it('serializes its state', () => {
    const ctx = new AudioContext();
    const bus = new SendBus(ctx, 'B', 'Send B', ctx.destination);
    bus.setReturnLevel(0.7);
    const s = bus.serialize();
    expect(s.id).toBe('B');
    expect(s.label).toBe('Send B');
    expect(s.returnLevel).toBeCloseTo(0.7, 3);
    expect(s.muted).toBe(false);
    expect(Array.isArray(s.inserts)).toBe(true);
  });
});
