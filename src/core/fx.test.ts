import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';

describe('ChannelStrip.getEqGainParam', () => {
  let ctx: AudioContext;
  let strip: ChannelStrip;

  beforeAll(() => {
    ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    strip = new ChannelStrip(ctx, ctx.destination, fx);
  });

  it('returns the AudioParam for the low band', () => {
    const p = strip.getEqGainParam('low');
    expect(p).toBeDefined();
    expect(typeof p.value).toBe('number');
  });

  it('the returned AudioParam reflects setEqLow writes', () => {
    const p = strip.getEqGainParam('low');
    strip.setEqLow(6);
    expect(p.value).toBeCloseTo(6, 5);
    strip.setEqLow(-3);
    expect(p.value).toBeCloseTo(-3, 5);
  });

  it('exposes mid and high too', () => {
    expect(strip.getEqGainParam('mid')).toBeDefined();
    expect(strip.getEqGainParam('high')).toBeDefined();
  });
});

describe('ChannelStrip compressor block', () => {
  let ctx: AudioContext;
  let strip: ChannelStrip;

  beforeAll(() => {
    ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    strip = new ChannelStrip(ctx, ctx.destination, fx);
  });

  it('starts bypassed by default', () => {
    expect(strip.serialize().comp.bypass).toBe(true);
  });

  it('setCompState merges with current state and round-trips through serialize', () => {
    strip.setCompState({ bypass: false, ratio: 6 });
    const s = strip.serialize();
    expect(s.comp.bypass).toBe(false);
    expect(s.comp.ratio).toBe(6);
  });

  it('restore() with a state missing `comp` falls back to defaults (migration)', () => {
    const fx2 = new FxBus(ctx, ctx.destination);
    const fresh = new ChannelStrip(ctx, ctx.destination, fx2);
    const legacy = fresh.serialize();
    delete (legacy as unknown as Record<string, unknown>).comp;
    fresh.restore(legacy as Parameters<ChannelStrip['restore']>[0]);
    expect(fresh.serialize().comp.bypass).toBe(true);
  });
});

describe('ChannelStrip sidechain tap registration', () => {
  let ctx: AudioContext;

  beforeAll(() => {
    ctx = new AudioContext();
  });

  it('registers itself with the bus on construction when a busId is given', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'bass', label: 'BASS' },
    });
    expect(bus.getTap('bass')).toBe(strip.sidechainTap);
  });

  it('dispose() unregisters the lane id from the bus', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'temp', label: 'TEMP' },
    });
    expect(bus.getTap('temp')).not.toBeNull();
    strip.dispose();
    expect(bus.getTap('temp')).toBeNull();
  });

  it('omitting the sidechain option leaves the strip un-registered (backward-compat)', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    new ChannelStrip(ctx, ctx.destination, fx);
    expect(bus.listSources()).toHaveLength(0);
  });
});
