import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { reverbPlugin } from '../plugins/fx/reverb';
import { delayPlugin } from '../plugins/fx/delay';

describe('FxBus as a 2-send bank', () => {
  beforeAll(() => { _resetRegistry(); registerPlugin(reverbPlugin); registerPlugin(delayPlugin); });

  it('exposes two sends A(delay) and B(reverb)', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(fx.sends.map((s) => s.id)).toEqual(['A', 'B']);
    expect(fx.getSendBus('A').label).toMatch(/delay/i);
    expect(fx.getSendBus('B').label).toMatch(/reverb/i);
  });

  it('reverbInput aliases bus B and delayInput aliases bus A', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(fx.reverbInput).toBe(fx.getSendBus('B').input);
    expect(fx.delayInput).toBe(fx.getSendBus('A').input);
  });
});

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

describe('ChannelStrip A/B sends', () => {
  beforeAll(() => { _resetRegistry(); registerPlugin(reverbPlugin); registerPlugin(delayPlugin); });

  it('serializes sendA/sendB and restores legacy reverbSend/delaySend', () => {
    // OFFLINE, deliberately. On a real-time AudioContext this test is a race:
    // it writes gain.value and reads it straight back, and under suite load the
    // read can return the audio thread's stale value (observed as "expected +0
    // to be close to 0.2"). An offline context has no such lag.
    const ctx = new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    strip.setSendA(0.3); strip.setSendB(0.6);
    const s = strip.serialize();
    expect(s.sendA).toBeCloseTo(0.3, 3);
    expect(s.sendB).toBeCloseTo(0.6, 3);

    const strip2 = new ChannelStrip(ctx, ctx.destination, fx);
    // Legacy save: delaySend → sendA, reverbSend → sendB
    strip2.restore({ ...s, sendA: undefined as unknown as number, sendB: undefined as unknown as number,
      delaySend: 0.2, reverbSend: 0.5 } as never);
    expect(strip2.serialize().sendA).toBeCloseTo(0.2, 3);
    expect(strip2.serialize().sendB).toBeCloseTo(0.5, 3);
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

  it('omitting the sidechain option keeps the strip off a bus a sibling registered with', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    new ChannelStrip(ctx, ctx.destination, fx); // no opts
    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'sibling', label: 'SIBLING' },
    });
    expect(bus.listSources().map((s) => s.id)).toEqual(['sibling']);
  });
});
