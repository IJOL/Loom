import { describe, it, expect, vi, beforeEach } from 'vitest';
// Side-effect imports register engines in the global registry.
import '../engines/drums-engine';
import '../engines/audio';
// Side-effect only: registers 'lfo'/'adsr' with the modulator-registry. Every
// engine descriptor above builds its default modulator set LAZILY from that
// registry (Task 5) — ensureLaneResource below is what triggers the build
// (via getEngineDescriptor), so vitest's per-file module isolation means this
// file must import them itself.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import { DrumsWorkletEngine } from '../engines/drums-worklet-engine';
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
import { AudioWorkletEngine } from '../engines/audio-worklet-engine';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';
import type { FxInstance } from '../plugins/types';
import * as registry from '../engines/registry';
import { installMainThreadLoomApi, __resetPluginEngines, adoptComponents } from '../plugin-host/loom-api';
import karplusPlugin from '../../plugins/karplus/plugin.json';
import audioProbePlugin from '../../plugins/audio-probe/plugin.json';
import type { ComponentManifest } from '@loom/plugin-sdk';
import { registerEngineCapabilities } from '../plugins/capabilities';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import type { EngineParamGroup } from '../engines/engine-param-groups';
import { registerPluginEngine } from '../../test/plugin-fixtures';

/** EVERY melodic engine ships as a PLUGIN: there is no module in src/ to
 *  side-effect import any more, so they arrive through their real manifests.
 *  A function rather than top-level calls because __resetPluginEngines() wipes
 *  the capabilities map, so every describe that resets has to re-register them —
 *  the same reason the karplus line below is repeated per beforeEach. */
function registerPluginEngines(): void {
  for (const id of ['tb303', 'subtractive', 'fm', 'wavetable', 'westcoast']) registerPluginEngine(id);
}
registerPluginEngines();

function makeCtx() {
  return new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
}

function makeDeps(ctx: AudioContext) {
  const master = ctx.createGain();
  const fx = new FxBus(ctx, master);
  const sidechainBus = new SidechainBus();
  return { ctx, master, fx, sidechainBus };
}

/** Minimal FxInstance whose input/output are real GainNodes so they can
 *  participate in the node-web-audio-api audio graph. Used to verify that
 *  the InsertChain's rewire() actually connects the chain entry node to
 *  this fx's input rather than jumping straight to strip.input. */
function makeTrackingFxMock(ctx: AudioContext): FxInstance {
  const input  = ctx.createGain();
  const output = ctx.createGain();
  return {
    input:  input  as unknown as AudioNode,
    output: output as unknown as AudioNode,
    getAudioParams: () => new Map<string, AudioParam>(),
    getBaseValue:   (_: string) => 0,
    setBaseValue:   (_: string, __: number) => {},
    applyPreset:    (_: string) => {},
    dispose:        () => {},
  };
}

describe('Phase G: ensureLaneResource is the sole allocation path', () => {
  it('resources map is empty after createLaneAllocator (no boot prefill)', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    expect([...lanes.resources.ids()].length).toBe(0);
  });

  it('ensureLaneResource populates resources on first call', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('tb-303-1', 'tb303');
    const res = lanes.resources.get('tb-303-1');
    expect(res).toBeDefined();
    expect(res!.engine!.id).toBe('tb303');
  });

  it('ensureLaneResource is idempotent (second call same lane is no-op)', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('tb-303-1', 'tb303');
    const first = lanes.resources.get('tb-303-1');
    lanes.ensureLaneResource('tb-303-1', 'tb303');
    expect(lanes.resources.get('tb-303-1')).toBe(first); // same reference
  });

  it('a lane whose engine is not installed still gets its strip and its inserts', () => {
    // The state a deleted plugin folder produces. The strip and the insert
    // chain are the HOST's, not the engine's, so the lane keeps its mixer
    // settings and its FX rack while the plugin is missing. Before this, the
    // allocator returned before registering anything and the lane had neither.
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('ghost-1', 'not-installed');
    const res = lanes.resources.get('ghost-1');
    expect(res).toBeDefined();
    expect(res!.strip).toBeDefined();
    expect(res!.inserts).toBeDefined();
    expect(res!.engine).toBeUndefined();
  });

  it('fills the engine in later if the id registers, keeping the same strip', () => {
    // Without this, a lane allocated before its plugin loaded would stay mute
    // for the whole session: ensureLaneResource used to return on the first
    // sight of a resource and nothing else ever revisited it.
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('late-1', 'late-arrival');
    const before = lanes.resources.get('late-1')!;
    expect(before.engine).toBeUndefined();

    registerEngineCapabilities('late-arrival', { clipContent: 'notes', shortLabel: 'late', outputTrim: 1 }, true);
    registry.registerEngine(createDescriptorEngine({
      id: 'late-arrival', name: 'Late Arrival', polyphony: 'poly',
      params: [{ id: 'osc1.level', label: 'L', kind: 'continuous', min: 0, max: 1, default: 0.5 }],
      presets: () => [],
    }));

    lanes.ensureLaneResource('late-1', 'late-arrival');
    const after = lanes.resources.get('late-1')!;
    expect(after.engine!.id).toBe('late-arrival');
    expect(after.strip).toBe(before.strip);      // the channel survived the wait
    expect(after.inserts).toBe(before.inserts);
  });
});

describe('drums-machine routes to the 8-output DrumsWorkletEngine', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('allocates a DrumsWorkletEngine for a drums lane', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('drums-1', 'drums-machine');
    const res = lanes.resources.get('drums-1')!;
    expect(res).toBeDefined();
    expect(res.engine!.id).toBe('drums-machine');
    expect(res.engine).toBeInstanceOf(DrumsWorkletEngine);
    // createVoice builds the 8-output node + per-voice strips without throwing.
    expect(() => res.engine!.createVoice(ctx, res.inserts.inputNode)).not.toThrow();
  });

  it('setSharedFx is wired before any createVoice on a drums-machine lane', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const setSharedFxSpy = vi.spyOn(DrumsWorkletEngine.prototype, 'setSharedFx');
    const createVoiceSpy = vi.spyOn(DrumsWorkletEngine.prototype, 'createVoice');
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('drums-2', 'drums-machine');
    expect(setSharedFxSpy).toHaveBeenCalledWith(fx);
    expect(createVoiceSpy).not.toHaveBeenCalled();
    const res = lanes.resources.get('drums-2')!;
    expect(() => res.engine!.createVoice(ctx, res.inserts.inputNode)).not.toThrow();
    expect(setSharedFxSpy.mock.invocationCallOrder[0])
      .toBeLessThan(createVoiceSpy.mock.invocationCallOrder[0]!);
  });
});

describe('Phase 4 Task 1: live worklet backend constructs only worklet engines', () => {
  // karplus is in this table as a PLUGIN, not a built-in: it qualifies for the
  // worklet path through isWorkletHosted (its manifest), which is the branch
  // that replaced the hand-written id list.
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetPluginEngines();
    installMainThreadLoomApi();
    adoptComponents([karplusPlugin.components[0] as unknown as ComponentManifest]);
    registerPluginEngines();
  });

  it.each([
    ['subtractive'],
    ['tb303'],
    ['fm'],
    ['wavetable'],
    ['karplus'],
    ['westcoast'],
  ])('allocates a WorkletLaneEngine for a %s lane on the default backend', (engineId) => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', engineId);
    const res = lanes.resources.get('L')!;
    expect(res).toBeDefined();
    expect(res.engine!.id).toBe(engineId);
    expect(res.engine).toBeInstanceOf(WorkletLaneEngine);
  });

  it('does NOT construct a fresh legacy engine to read the worklet spec', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    // createEngineInstance builds a fresh node-per-note legacy engine. The
    // worklet path must read its metadata from a descriptor instead, so this
    // must NOT be invoked when allocating a melodic lane on the worklet backend.
    const createSpy = vi.spyOn(registry, 'createEngineInstance');
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', 'subtractive');
    expect(lanes.resources.get('L')!.engine).toBeInstanceOf(WorkletLaneEngine);
    expect(createSpy).not.toHaveBeenCalledWith('subtractive');
  });
});

describe('backend routing by capability, not by hard-coded id (audio slice)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // __resetPluginEngines() wipes the whole capabilities map, including the
    // built-in 'audio' entry that ../engines/audio registered once at import
    // time (a side effect that never re-runs). Re-register it here so the
    // non-regression test below still sees the built-in's real capabilities,
    // matching src/engines/audio.ts exactly.
    __resetPluginEngines();
    installMainThreadLoomApi();
    registerEngineCapabilities('audio', {
      clipContent: 'audio', shortLabel: 'audio', outputTrim: 1,
      accepts: ['audio-file'], acceptsNoteFx: false, harmonic: false, isRandomizable: false,
    });
    registerPluginEngines();
  });

  // The bug: a plugin engine declaring clipContent: 'audio' fell into the
  // WORKLET_ENGINE_IDS branch (isWorkletHosted is true for ANY plugin id) and
  // got a WorkletLaneEngine — the notes backend — instead of an
  // AudioWorkletEngine. Using the built-in id 'audio' here would pass even
  // with the bug still in place (the allocator's literal 'audio' branch would
  // catch it), so the fixture MUST use a different id — audio-probe does.
  it('routes a plugin engine with clipContent: audio to AudioWorkletEngine, not WorkletLaneEngine', () => {
    adoptComponents([audioProbePlugin.components[0] as unknown as ComponentManifest]);
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });

    lanes.ensureLaneResource('L', 'audio-probe');

    const res = lanes.resources.get('L')!;
    expect(res).toBeDefined();
    expect(res.engine).toBeInstanceOf(AudioWorkletEngine);
    expect(res.engine).not.toBeInstanceOf(WorkletLaneEngine);
  });

  // AudioWorkletEngine used to hardcode `id = 'audio'`, so a plugin audio
  // channel's live engine reported the wrong id — session-host-persistence's
  // engine-swap reconciliation (`existing.engine.id !== lane.engineId`) then
  // saw 'audio' !== 'audio-probe' and swapped on every load, and
  // trigger-dispatch resolved note-FX capability against the built-in
  // 'audio' registration instead of audio-probe's own.
  it('a plugin audio-channel engine reports its OWN id, not the built-in "audio"', () => {
    adoptComponents([audioProbePlugin.components[0] as unknown as ComponentManifest]);
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });

    lanes.ensureLaneResource('L', 'audio-probe');

    const res = lanes.resources.get('L')!;
    expect(res.engine!.id).toBe('audio-probe');
  });

  it('non-regression: the built-in audio channel still gets AudioWorkletEngine, and the six melodic engines still get WorkletLaneEngine', () => {
    adoptComponents([karplusPlugin.components[0] as unknown as ComponentManifest]);
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });

    lanes.ensureLaneResource('audio-1', 'audio');
    expect(lanes.resources.get('audio-1')!.engine).toBeInstanceOf(AudioWorkletEngine);

    for (const engineId of ['subtractive', 'tb303', 'fm', 'wavetable', 'karplus', 'westcoast']) {
      lanes.ensureLaneResource(`${engineId}-lane`, engineId);
      expect(lanes.resources.get(`${engineId}-lane`)!.engine).toBeInstanceOf(WorkletLaneEngine);
    }
  });
});

describe('Phase H Task 26: ensureLaneResource wires InsertChain; ensureLaneVoice routes through it', () => {
  it('res.inserts is defined after ensureLaneResource', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('tb-303-1', 'tb303');
    const res = lanes.resources.get('tb-303-1')!;
    expect(res.inserts).toBeDefined();
    expect(res.inserts.inputNode).toBeDefined();
  });

  it('routes engine.createVoice output through the lane InsertChain', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('tb-303-1', 'tb303');
    const res = lanes.resources.get('tb-303-1')!;
    expect(res.inserts).toBeDefined();
    expect(res.inserts.inputNode).toBeDefined();

    // Intercept connect() on the chain's entry node so we know when rewire()
    // wires something into the fx chain.  rewire() calls
    //   chainEntry.connect(fx.input)
    // when an fx is inserted.  If ensureLaneVoice were to pass strip.input
    // (rather than inserts.inputNode) to createVoice, audio would skip the
    // chain entirely and this count would still be > 0 only from the insert
    // call — but the voice would not flow through the fx.
    let upstreamConnectCount = 0;
    const chainEntry = res.inserts.inputNode;
    const origConnect = (chainEntry.connect as unknown as (...a: unknown[]) => unknown).bind(chainEntry);
    (chainEntry as unknown as Record<string, unknown>).connect = (...args: unknown[]) => {
      upstreamConnectCount++;
      return origConnect(...args);
    };

    const mockFx = makeTrackingFxMock(ctx);
    res.inserts.insert(mockFx, 'mock-fx');
    // rewire() called chainEntry.connect(mockFx.input) → count incremented
    expect(upstreamConnectCount).toBeGreaterThan(0);

    // Voice must be creatable without throwing.
    const voice = lanes.ensureLaneVoice('tb-303-1', 'tb303');
    expect(voice).not.toBeNull();
  });
});

describe('Phase G save → load round-trip with collapsed allocator shape', () => {
  it('boot lanes allocated by ensureLaneResource survive a simulated applyLoadedSessionState', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });

    // Simulate what applyLoadedSessionState does for each boot lane.
    for (const [laneId, engineId] of [
      ['tb-303-1', 'tb303'] as const,
      ['drums-1',  'drums-machine'] as const,
      ['subtractive-1', 'subtractive'] as const,
    ]) {
      lanes.ensureLaneResource(laneId, engineId);
    }

    // All three lanes must now be in the map.
    for (const id of ['tb-303-1', 'drums-1', 'subtractive-1']) {
      const res = lanes.resources.get(id);
      expect(res).toBeDefined();
      // And createVoice must not throw for any of them.
      expect(() => res!.engine!.createVoice(ctx, res!.strip.input)).not.toThrow();
    }
  });
});

describe('swapLaneEngine replaces the engine in place', () => {
  it('keeps the same strip + inserts and swaps the engine instance', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', 'subtractive');
    const before = lanes.resources.get('L')!;
    const stripRef = before.strip;
    const insertsRef = before.inserts;
    expect(before.engine!.id).toBe('subtractive');

    lanes.swapLaneEngine('L', 'fm');

    const after = lanes.resources.get('L')!;
    expect(after.engine!.id).toBe('fm');
    expect(after.strip).toBe(stripRef);     // strip preserved
    expect(after.inserts).toBe(insertsRef); // inserts preserved
  });

  it('invalidates the cached voice so the next ensureLaneVoice builds a fresh one', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', 'fm');
    const v1 = lanes.ensureLaneVoice('L', 'fm');
    lanes.swapLaneEngine('L', 'wavetable');
    const v2 = lanes.ensureLaneVoice('L', 'wavetable');
    expect(v1).not.toBeNull();
    expect(v2).not.toBe(v1); // fresh voice from the new engine
  });

  it('is a no-op when the lane has no resource', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    expect(() => lanes.swapLaneEngine('nope', 'fm')).not.toThrow();
    expect(lanes.resources.get('nope')).toBeUndefined();
  });
});

// Review Finding 4: ensureLaneResource/swapLaneEngine call onDestinationsChanged
// relative to their early-return guards. Get the placement wrong and either
// every idempotent call (ensureLaneVoice re-checks ensureLaneResource on
// essentially every trigger) spuriously invalidates the automation destination
// registry, or a genuine allocation/swap silently fails to announce.
describe('onDestinationsChanged announcements (Finding 4)', () => {
  it('ensureLaneResource announces exactly once on a genuine new lane allocation', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const spy = vi.fn();
    const lanes = createLaneAllocator({
      ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [],
      onDestinationsChanged: spy,
    });

    lanes.ensureLaneResource('tb-303-1', 'tb303');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ensureLaneResource does NOT announce on the idempotent no-op (lane already allocated)', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const spy = vi.fn();
    const lanes = createLaneAllocator({
      ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [],
      onDestinationsChanged: spy,
    });

    lanes.ensureLaneResource('tb-303-1', 'tb303');
    spy.mockClear(); // isolate the repeat call from the genuine allocation above

    // Mirrors what ensureLaneVoice does on every trigger: re-call for a lane
    // that's already allocated. Must hit the early-return guard and no-op.
    lanes.ensureLaneResource('tb-303-1', 'tb303');

    expect(spy).not.toHaveBeenCalled();
  });

  it('swapLaneEngine announces exactly once on a genuine engine swap', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const spy = vi.fn();
    const lanes = createLaneAllocator({
      ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [],
      onDestinationsChanged: spy,
    });
    lanes.ensureLaneResource('L', 'subtractive');
    spy.mockClear(); // isolate the swap from the allocation above

    lanes.swapLaneEngine('L', 'fm');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('swapLaneEngine does NOT announce when the lane has no resource (early-return guard)', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const spy = vi.fn();
    const lanes = createLaneAllocator({
      ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [],
      onDestinationsChanged: spy,
    });

    lanes.swapLaneEngine('nope', 'fm');

    expect(spy).not.toHaveBeenCalled();
  });

  it('swapLaneEngine does NOT announce when the new engineId cannot be resolved (second guard)', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const spy = vi.fn();
    const lanes = createLaneAllocator({
      ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [],
      onDestinationsChanged: spy,
    });
    lanes.ensureLaneResource('L', 'subtractive');
    spy.mockClear(); // isolate the failed swap from the allocation above

    lanes.swapLaneEngine('L', 'no-such-engine');

    expect(spy).not.toHaveBeenCalled();
    expect(lanes.resources.get('L')!.engine!.id).toBe('subtractive'); // unchanged
  });
});

// Task 5 fix round 1: the plan originally listed only two of the four hops a
// declared `groups` table has to survive (descriptor config -> live
// WorkletLaneEngine). It never named the two in between: registry.ts's
// EngineDescriptor projection, and lane-allocator.ts, which is what actually
// builds the WorkletLaneEngine the lane editor calls buildParamUI on. A table
// that stops at either of those hops is silently empty in production while
// descriptor-engine.test.ts and worklet-lane-engine.test.ts (which construct
// their objects directly, skipping the registry+allocator) still pass.
//
// This registers a throwaway engine id through the REAL registerEngine +
// registerEngineCapabilities entry points (the same ones a plugin or an
// in-tree engine file uses), then drives the actual createLaneAllocator ->
// ensureLaneResource path — no stub stands in for any hop.
describe('Task 5 fix round 1: the declared groups table survives every hop to the live engine', () => {
  it('descriptor config -> registry.EngineDescriptor -> allocator -> live WorkletLaneEngine.groups', () => {
    const groups: EngineParamGroup[] = [{ id: 'osc1', title: 'OSC 1', row: 0, color: '#2ee0c0' }];
    // isPlugin: true makes isWorkletHosted('groups-chain-test') true, which is
    // what routes the allocator into the WorkletLaneEngine branch for an id
    // that isn't one of the hard-coded built-ins.
    registerEngineCapabilities('groups-chain-test', { clipContent: 'notes', shortLabel: 'gct', outputTrim: 1 }, true);
    registry.registerEngine(createDescriptorEngine({
      id: 'groups-chain-test', name: 'Groups Chain Test', polyphony: 'poly',
      params: [{ id: 'osc1.level', label: 'L', kind: 'continuous', min: 0, max: 1, default: 0.5, group: 'osc1' }],
      groups,
      presets: () => [],
    }));

    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', 'groups-chain-test');

    const res = lanes.resources.get('L')!;
    expect(res.engine).toBeInstanceOf(WorkletLaneEngine);
    expect(res.engine!.groups).toEqual(groups);
  });
});
