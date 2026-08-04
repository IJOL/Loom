import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { reverbPlugin } from '../plugins/fx/reverb';
import { delayPlugin } from '../plugins/fx/delay';
import { loadPlugins } from '../plugin-host/plugin-host';

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

describe('FxBus.seedDefaultInserts', () => {
  it('is born empty: plugins load asynchronously and the bus is built before they do', () => {
    _resetRegistry(); registerPlugin(delayPlugin); registerPlugin(reverbPlugin);
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(fx.getSendBus('A').inserts.size()).toBe(0);
  });

  it('seeds delay on A and reverb on B when asked, after the plugins exist', () => {
    _resetRegistry(); registerPlugin(delayPlugin); registerPlugin(reverbPlugin);
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    fx.seedDefaultInserts(ctx);
    expect(fx.getSendBus('A').inserts.size()).toBe(1);
    expect(fx.getSendBus('B').inserts.size()).toBe(1);
  });

  it('seeding twice does not stack two delays', () => {
    _resetRegistry(); registerPlugin(delayPlugin); registerPlugin(reverbPlugin);
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    fx.seedDefaultInserts(ctx);
    fx.seedDefaultInserts(ctx);
    expect(fx.getSendBus('A').inserts.size()).toBe(1);
  });

  it('survives the plugins being absent: the sends pass dry', () => {
    _resetRegistry();
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(() => fx.seedDefaultInserts(ctx)).not.toThrow();
    expect(fx.getSendBus('A').inserts.size()).toBe(0);
  });

  // The regression this whole file guards against is an ORDERING bug, not a
  // missing feature: seedDefaultInserts existing is not enough, it has to be
  // called AFTER the plugin registers, never before or instead. The four
  // tests above each call it in a single, already-decided registry state; this
  // one calls it TWICE against the SAME FxBus instance, once before the
  // plugin exists and once after, so it is the ordering itself under test —
  // exactly what would still be broken if main.ts called seedDefaultInserts
  // synchronously, right next to the constructor, instead of behind
  // `pluginsReady.then(...)`.
  it('reflects the registry at CALL time, not at construction time', () => {
    _resetRegistry();
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);

    // This is today's boot instant for a runtime plugin: the audio graph (and
    // its FxBus) already exists, but nothing has registered yet.
    fx.seedDefaultInserts(ctx);
    expect(fx.getSendBus('A').inserts.size(), 'nothing to seed with yet').toBe(0);

    // The plugin arrives later — loadPlugins() resolving, in production.
    registerPlugin(delayPlugin);
    registerPlugin(reverbPlugin);

    // main.ts's `pluginsReady.then(() => fx.seedDefaultInserts(ctx))` firing.
    fx.seedDefaultInserts(ctx);
    expect(fx.getSendBus('A').inserts.size(), 'delay seeded once it actually existed').toBe(1);
    expect(fx.getSendBus('B').inserts.size(), 'reverb seeded once it actually existed').toBe(1);
  });
});

describe('FxBus.seedDefaultInserts — driven by the real plugin loader', () => {
  // Not a stand-in promise: `loadPlugins` IS the function main.ts assigns to
  // `pluginsReady` (src/main.ts: `const pluginsReady = loadPlugins();`). Fake
  // only the network edge (fetch + module import), the same seam
  // plugin-host.test.ts already uses, so the async fetch → validate → import →
  // registerFx chain that runs in production runs here too. If seeding ever
  // moved back before this promise, or main.ts started this chain but read
  // the bus without awaiting it, this is the test that would catch it.
  function fxManifest(id: string, name: string) {
    return {
      id, name, version: '1.0.0', loomApi: 1, main: 'main.js',
      components: [{ kind: 'fx' as const, id, name, params: [], fx: { color: '#000' } }],
    };
  }
  function fakeFetch(files: Record<string, unknown>): typeof fetch {
    return (async (url: string) => {
      const key = Object.keys(files).find((k) => String(url).endsWith(k));
      if (key === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => files[key] } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('stays empty while the real loader is still fetching, then fills once pluginsReady resolves', async () => {
    _resetRegistry();
    const ctx = new AudioContext();

    // The exact main.ts moment: the audio graph — and its FxBus — is built
    // synchronously; loadPlugins() has only just been called and its fetches
    // have not settled.
    const fx = new FxBus(ctx, ctx.destination);
    const pluginsReady = loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['delay', 'reverb'] },
        'plugins/delay/plugin.json': fxManifest('delay', 'Delay'),
        'plugins/reverb/plugin.json': fxManifest('reverb', 'Reverb'),
      }),
      importImpl: async (url: string) => {
        const id = url.includes('reverb') ? 'reverb' : 'delay';
        (globalThis as unknown as { Loom: { registerFx(id: string, c: unknown): void } }).Loom
          .registerFx(id, (c: AudioContext) => ({
            input: c.createGain(), output: c.createGain(),
            getAudioParams: () => new Map(),
            getBaseValue: () => 0, setBaseValue: () => {}, applyPreset: () => {},
            dispose: () => {},
          }));
      },
    });

    // In flight: this is the SAME instant a lane's ChannelStrip already
    // exists and connects into fx.delayInput/reverbInput on the live path.
    expect(fx.getSendBus('A').inserts.size(), 'still fetching — nothing registered yet').toBe(0);

    // main.ts's own line, verbatim: void pluginsReady.then(() => fx.seedDefaultInserts(ctx));
    await pluginsReady.then(() => { fx.seedDefaultInserts(ctx); });

    expect(fx.getSendBus('A').inserts.size(), 'A got delay once the real loader resolved').toBe(1);
    expect(fx.getSendBus('B').inserts.size(), 'B got reverb once the real loader resolved').toBe(1);
  });
});

describe('ChannelStrip.getEqGainParam', () => {
  let ctx: AudioContext;
  let strip: ChannelStrip;

  beforeAll(() => {
    // OFFLINE, deliberately — same race as the "ChannelStrip A/B sends" test
    // below: writing an AudioParam's .value and reading it straight back on a
    // real-time AudioContext can return the audio thread's stale value under
    // suite load (observed as "expected +0 to be close to 6" for setEqLow).
    // An offline context has no such lag.
    ctx = new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext;
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

  it('serializes sendA/sendB and restores them on a fresh strip', () => {
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
    strip2.restore(s);
    expect(strip2.serialize().sendA).toBeCloseTo(0.3, 3);
    expect(strip2.serialize().sendB).toBeCloseTo(0.6, 3);
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
