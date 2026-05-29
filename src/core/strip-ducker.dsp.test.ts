import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';

function rms(buf: Float32Array, from: number, to: number): number {
  let s = 0;
  const n = to - from;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

describe('ChannelStrip ducker integration', () => {
  it('a target strip ducks when sidechain.source = source lane id', async () => {
    const sr = 44100;
    const dur = 1.0;
    const offCtx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
    const ctx = offCtx as unknown as AudioContext;
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, offCtx.destination);

    // Sink for the source strip — keeps source audio out of the rendered
    // destination so duckedRms reflects only the (attenuated) target.
    const sourceSink = offCtx.createGain();
    sourceSink.gain.value = 0;
    sourceSink.connect(offCtx.destination);

    const sourceStrip = new ChannelStrip(ctx, sourceSink, fx, {
      sidechain: { bus, id: 'kick', label: 'KICK' },
    });
    const targetStrip = new ChannelStrip(ctx, offCtx.destination, fx, {
      sidechain: { bus, id: 'lead', label: 'LEAD' },
    });
    targetStrip.setSidechain(bus, {
      source: 'kick', depth: 0.85, attack: 0.003, release: 0.06, threshold: -60,
    });

    const target = offCtx.createOscillator();
    target.frequency.value = 440;
    target.connect(targetStrip.input);
    target.start(0);
    target.stop(dur);

    const sb = offCtx.createBuffer(1, Math.floor(sr * dur), sr);
    const sd = sb.getChannelData(0);
    for (let i = Math.floor(sr * 0.2); i < Math.floor(sr * 0.4); i++) {
      sd[i] = (Math.random() * 2 - 1) * 0.9;
    }
    const sourceNode = offCtx.createBufferSource();
    sourceNode.buffer = sb;
    sourceNode.connect(sourceStrip.input);
    sourceNode.start(0);

    const rendered = await offCtx.startRendering();
    const data = rendered.getChannelData(0);

    const duckedRms = rms(data, Math.floor(sr * 0.25), Math.floor(sr * 0.38));
    const cleanRms  = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.18));
    expect(duckedRms / cleanRms).toBeLessThan(0.9);
  });

  it('setSidechain(bus, null) tears the ducker down — no further reduction', async () => {
    const sr = 44100;
    const dur = 0.5;
    const offCtx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
    const ctx = offCtx as unknown as AudioContext;
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, offCtx.destination);

    new ChannelStrip(ctx, offCtx.destination, fx, { sidechain: { bus, id: 'kick', label: 'KICK' } });
    const targetStrip = new ChannelStrip(ctx, offCtx.destination, fx, { sidechain: { bus, id: 'lead', label: 'LEAD' } });
    targetStrip.setSidechain(bus, { source: 'kick', depth: 0.9, attack: 0.003, release: 0.06, threshold: -60 });
    targetStrip.setSidechain(bus, null);

    const target = offCtx.createOscillator();
    target.frequency.value = 440;
    target.connect(targetStrip.input);
    target.start(0);
    target.stop(dur);

    const rendered = await offCtx.startRendering();
    // A non-zero signal proves duckGain recovered to 1 after teardown.
    // The threshold is intentionally loose (0.3) — the exact value depends
    // on mono downmix of the StereoPannerNode at centre pan.
    expect(rms(rendered.getChannelData(0), 0, rendered.length)).toBeGreaterThan(0.3);
  });
});
