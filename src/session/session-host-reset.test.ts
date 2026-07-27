import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SessionHost } from './session-host';
import { ChannelStrip, FxBus, MasterCompressor } from '../core/fx';
import { MasterBusStrip } from '../core/master-bus-strip';
import { MasterShaper, MASTER_SHAPER_DEFAULTS } from '../core/master-shaper';
import { InsertChain } from '../plugins/fx/insert-chain';
import { DEFAULT_COMP_STATE } from '../core/comp-state';
import { emptySessionState } from './session';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { fakeDestinations } from './fake-destinations';
import type { FxInstance } from '../plugins/types';
import type { KnobHandle } from '../core/knob';

// Regression: "ni New ni cargar la demo otra vez resetea el mixer — los sends
// siguen al mismo nivel". Replacing the session only ever PUSHED the fields the
// incoming JSON happened to carry, and demo/empty states carry no per-lane
// `mixer`; the lane's ChannelStrip was reused (ensureLaneResource is idempotent
// on a surviving lane id) so level/pan/EQ/sends/mute survived the wipe. Same
// class of leak for the master rack, the send buses, the master processors,
// mute/solo and the per-lane note-FX chains.
//
// The contract these tests pin: New releases EVERY live resource, and loading a
// session IS New + apply.

(globalThis as unknown as { document: unknown }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

/** Minimal insert to occupy a rack slot — the racks must be emptied whatever
 *  they hold, so the plugin registry is beside the point here. */
function fakeInsert(ctx: AudioContext): FxInstance {
  const node = ctx.createGain();
  return {
    input: node, output: node,
    getAudioParams: () => new Map(),
    getBaseValue: () => 0, setBaseValue: () => {}, applyPreset: () => {},
    dispose: () => {},
  };
}

interface Fixture {
  host: SessionHost;
  ctx: AudioContext;
  fx: FxBus;
  strips: Map<string, ChannelStrip>;
  masterRack: InsertChain;
  masterStrip: MasterBusStrip;
  masterComp: MasterCompressor;
  masterShaper: MasterShaper;
  registry: Map<string, KnobHandle>;
  muteState: Record<string, boolean>;
  soloState: Record<string, boolean>;
  ensure: (id: string, engineId: string) => void;
}

/** A stand-in for the real allocator contract: `ensureLaneResource` is
 *  idempotent per lane id, `dispose` frees. That idempotence is exactly why a
 *  surviving lane kept its old strip — the fake has to reproduce it or the test
 *  cannot see the bug. */
function makeFixture(): Fixture {
  const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strips = new Map<string, ChannelStrip>();
  const resources = new Map<string, { engine: { id: string }; strip: ChannelStrip; inserts: InsertChain }>();

  const ensure = (id: string, engineId: string): void => {
    if (resources.has(id)) return;
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    strips.set(id, strip);
    resources.set(id, { engine: { id: engineId }, strip, inserts: new InsertChain(ctx.createGain(), strip.input) });
  };
  const laneResources = {
    get: (id: string) => resources.get(id),
    ids: () => [...resources.keys()],
    dispose: (id: string) => { resources.get(id)?.strip.dispose(); resources.delete(id); },
  };

  const masterRack = new InsertChain(ctx.createGain(), ctx.destination);
  const masterStrip = new MasterBusStrip(ctx);
  const masterComp = new MasterCompressor(ctx);
  const masterShaper = new MasterShaper(ctx);
  const registry = new Map<string, KnobHandle>();
  const muteState: Record<string, boolean> = {};
  const soloState: Record<string, boolean> = {};

  const host = new SessionHost({
    ctx, laneResources, ensureLaneResource: ensure, destinations: fakeDestinations(),
    automationRegistry: registry, fxBus: fx, masterInsertChain: masterRack,
    masterStrip, masterComp, masterShaper,
    mixerDeps: { muteState, soloState } as never,
  } as unknown as ConstructorParameters<typeof SessionHost>[0]);

  return {
    host, ctx, fx, strips, masterRack, masterStrip, masterComp, masterShaper,
    registry, muteState, soloState, ensure,
  };
}

describe('SessionHost.resetAllResources — New releases every live resource', () => {
  it('disposes every lane resource, so a surviving lane id gets a FRESH strip', () => {
    const f = makeFixture();
    f.ensure('tb-303-1', 'tb303');
    const before = f.strips.get('tb-303-1')!;
    before.setSendA(0.8);
    before.setSendB(0.65);
    before.setLevel(0.2);

    f.host.resetAllResources();

    expect(f.host.deps.laneResources!.ids(), 'no lane resource survives New').toEqual([]);
    f.ensure('tb-303-1', 'tb303');
    const after = f.strips.get('tb-303-1')!.serialize();
    expect(after.sendA, 'send A is back at its default').toBeCloseTo(0, 4);
    expect(after.sendB, 'send B is back at its default').toBeCloseTo(0, 4);
    expect(after.level, 'level is back at its default').toBeCloseTo(1, 4);
  });

  it('empties the master insert rack', () => {
    const f = makeFixture();
    f.masterRack.insert(fakeInsert(f.ctx), 'slot-1');
    expect(f.masterRack.size()).toBe(1);

    f.host.resetAllResources();

    expect(f.masterRack.size(), 'the master rack is empty after New').toBe(0);
  });

  it('returns both send buses to their default return level, mute and rack', () => {
    const f = makeFixture();
    for (const bus of f.fx.sends) {
      bus.setReturnLevel(0.15);
      bus.setMuted(true);
      bus.inserts.insert(fakeInsert(f.ctx), `${bus.id}-slot`);
    }

    f.host.resetAllResources();

    for (const bus of f.fx.sends) {
      expect(bus.getReturnLevel(), `${bus.id} return level`).toBeCloseTo(1, 4);
      expect(bus.isMuted(), `${bus.id} unmuted`).toBe(false);
      expect(bus.inserts.size(), `${bus.id} rack emptied`).toBe(0);
    }
  });

  it('returns the master strip, compressor and shaper to their defaults', () => {
    const f = makeFixture();
    // pan is set via setTargetAtTime and never converges in an unrendered
    // OfflineAudioContext, so it is not observable here — EQ/mute carry the proof.
    f.masterStrip.restore({ eqLow: 6, eqMid: -4, eqHigh: 5, muted: true });
    f.masterComp.setState({ threshold: -40, ratio: 12 });
    f.masterShaper.setState({ airDb: 6, width: 0.8, mbOn: true });

    f.host.resetAllResources();

    const strip = f.masterStrip.serialize();
    expect(strip.eqLow).toBeCloseTo(0, 4);
    expect(strip.eqMid).toBeCloseTo(0, 4);
    expect(strip.eqHigh).toBeCloseTo(0, 4);
    expect(strip.muted).toBe(false);
    expect(f.masterComp.getState().threshold).toBeCloseTo(DEFAULT_COMP_STATE.threshold, 4);
    expect(f.masterComp.getState().ratio).toBeCloseTo(DEFAULT_COMP_STATE.ratio, 4);
    expect(f.masterShaper.getState().airDb).toBeCloseTo(MASTER_SHAPER_DEFAULTS.airDb, 4);
    expect(f.masterShaper.getState().width).toBeCloseTo(MASTER_SHAPER_DEFAULTS.width, 4);
    expect(f.masterShaper.getState().mbOn).toBe(MASTER_SHAPER_DEFAULTS.mbOn);
  });

  it('frees lanes through the allocator, not the bare resource map', () => {
    // `laneResources.dispose` frees strip/engine/inserts and nothing else — the
    // cached voice, the standalone strip and the voice-cap entry live in the
    // allocator. A reset that took the short path would leak all three.
    const f = makeFixture();
    const freed: string[] = [];
    (f.host.deps as { releaseLane?: (id: string) => void }).releaseLane = (id) => {
      freed.push(id);
      f.host.deps.laneResources!.dispose(id);
    };
    f.ensure('tb-303-1', 'tb303');
    f.ensure('drums-1', 'drums-machine');

    f.host.resetAllResources();

    expect(freed.sort()).toEqual(['drums-1', 'tb-303-1']);
    expect(f.host.deps.laneResources!.ids()).toEqual([]);
  });

  it('clears mute/solo, the knob registry and the per-lane note-FX chains', () => {
    const f = makeFixture();
    f.muteState['tb-303-1'] = true;
    f.soloState['drums-1'] = true;
    f.registry.set('tb-303-1.bus.level', {} as KnobHandle);
    getNoteFxChain('tb-303-1').addNoteFx('arp');

    f.host.resetAllResources();

    expect(f.muteState['tb-303-1'], 'mute does not survive New').toBe(false);
    expect(f.soloState['drums-1'], 'solo does not survive New').toBe(false);
    expect(f.registry.size, 'no lane knob handle survives New').toBe(0);
    expect(getNoteFxChain('tb-303-1').serialize(), 'note-FX chain cleared').toEqual([]);
  });
});

describe('SessionHost.replaceSession — loading a session IS New + apply', () => {
  it('resets the desk before applying, so a state without `mixer` lands on defaults', () => {
    const f = makeFixture();
    f.ensure('tb-303-1', 'tb303');
    f.strips.get('tb-303-1')!.setSendA(0.9);
    for (const bus of f.fx.sends) bus.setReturnLevel(0.1);

    // The same lane id in the incoming state — the reuse path that kept the
    // stale strip. The demo JSONs carry no per-lane `mixer`, exactly like this.
    f.host.replaceSession({
      ...emptySessionState(),
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [], inserts: [] }],
    });

    expect(f.strips.get('tb-303-1')!.serialize().sendA, 'send A reset by the load').toBeCloseTo(0, 4);
    for (const bus of f.fx.sends) expect(bus.getReturnLevel()).toBeCloseTo(1, 4);
  });

  it('still applies a state that DOES carry a mixer (a save keeps its levels)', () => {
    const f = makeFixture();
    const src = new ChannelStrip(f.ctx, f.ctx.destination, f.fx);
    src.setSendA(0.42);
    src.setLevel(0.3);

    f.host.replaceSession({
      ...emptySessionState(),
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [], inserts: [], mixer: src.serialize() }],
    });

    const after = f.strips.get('tb-303-1')!.serialize();
    expect(after.sendA, 'a saved send level survives the reset').toBeCloseTo(0.42, 4);
    expect(after.level).toBeCloseTo(0.3, 4);
  });
});
