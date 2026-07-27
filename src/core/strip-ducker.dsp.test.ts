import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';

// Strip-level sidechain contract. The audible ducking is NOT measured here any
// more: the follower is an AudioWorklet processor and node-web-audio-api can't run
// it (see ducker-subgraph.wiring.test.ts for how the coverage is split). What a
// node render CAN still prove is the thing that used to break lanes silently — a
// strip whose ducker is torn down, or whose source does not exist, must keep
// passing audio at unity instead of going quiet.

function rms(buf: Float32Array, from: number, to: number): number {
  let s = 0;
  const n = to - from;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

async function renderStrip(configure: (strip: ChannelStrip, bus: SidechainBus) => void): Promise<number> {
  const sr = 44100;
  const dur = 0.4;
  const offCtx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
  const ctx = offCtx as unknown as AudioContext;
  const bus = new SidechainBus();
  const fx = new FxBus(ctx, offCtx.destination);

  new ChannelStrip(ctx, offCtx.destination, fx, { sidechain: { bus, id: 'kick', label: 'KICK' } });
  const target = new ChannelStrip(ctx, offCtx.destination, fx, { sidechain: { bus, id: 'lead', label: 'LEAD' } });
  configure(target, bus);

  const osc = offCtx.createOscillator();
  osc.frequency.value = 440;
  osc.connect(target.input);
  osc.start(0);
  osc.stop(dur);

  const rendered = await offCtx.startRendering();
  // The threshold below is loose (0.3) on purpose — the exact value depends on the
  // mono downmix of the StereoPanner at centre pan.
  return rms(rendered.getChannelData(0), 0, rendered.length);
}

describe('ChannelStrip sidechain contract', () => {
  it('setSidechain(bus, null) tears the ducker down — the lane is back at unity', async () => {
    const level = await renderStrip((strip, bus) => {
      strip.setSidechain(bus, { source: 'kick', depth: 0.9, attack: 0.003, release: 0.06, threshold: -60 });
      strip.setSidechain(bus, null);
    });
    expect(level).toBeGreaterThan(0.3);
  });

  it('an unknown source id leaves the lane audible, not silent', async () => {
    const level = await renderStrip((strip, bus) => {
      strip.setSidechain(bus, { source: 'does-not-exist', depth: 0.9, attack: 0.003, release: 0.06, threshold: -60 });
    });
    expect(level).toBeGreaterThan(0.3);
  });

  it('keeps the sidechain state it was given, and clears it', async () => {
    const sr = 44100;
    const offCtx = new OfflineAudioContext(1, 128, sr);
    const ctx = offCtx as unknown as AudioContext;
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, offCtx.destination);
    new ChannelStrip(ctx, offCtx.destination, fx, { sidechain: { bus, id: 'kick', label: 'KICK' } });
    const strip = new ChannelStrip(ctx, offCtx.destination, fx, { sidechain: { bus, id: 'lead', label: 'LEAD' } });

    const state = { source: 'kick', depth: 0.42, attack: 0.01, release: 0.3, threshold: -60 };
    strip.setSidechain(bus, state);
    expect(strip.getSidechain()).toEqual(state);
    expect(strip.serialize().sidechain).toEqual(state);
    strip.setSidechain(bus, null);
    expect(strip.getSidechain()).toBeNull();
  });
});
