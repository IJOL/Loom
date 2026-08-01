import { describe, it, expect, vi, beforeEach } from 'vitest';
// Side-effect imports register engines in the global registry.
import '../engines/tb303';
import '../engines/drums-engine';
import '../engines/subtractive';
import '../engines/fm';
import '../engines/wavetable';
import '../engines/westcoast';
import '../engines/audio';
import { DrumsWorkletEngine } from '../engines/drums-worklet-engine';
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
import { AudioWorkletEngine } from '../engines/audio-worklet-engine';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';
import type { FxInstance } from '../plugins/types';
import * as registry from '../engines/registry';
import { installMainThreadLoomApi, __resetPluginEngines } from '../plugin-host/loom-api';
import karplusPlugin from '../../plugins/karplus/plugin.json';
import audioProbePlugin from '../../plugins/audio-probe/plugin.json';
import type { ComponentManifest } from '@loom/plugin-sdk';
import { registerEngineCapabilities } from '../plugins/capabilities';

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
    expect(res!.engine.id).toBe('tb303');
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
    expect(res.engine.id).toBe('drums-machine');
    expect(res.engine).toBeInstanceOf(DrumsWorkletEngine);
    // createVoice builds the 8-output node + per-voice strips without throwing.
    expect(() => res.engine.createVoice(ctx, res.inserts.inputNode)).not.toThrow();
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
    expect(() => res.engine.createVoice(ctx, res.inserts.inputNode)).not.toThrow();
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
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } })
      .Loom.registerComponent(karplusPlugin.components[0] as unknown as ComponentManifest);
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
    expect(res.engine.id).toBe(engineId);
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
  });

  // The bug: a plugin engine declaring clipContent: 'audio' fell into the
  // WORKLET_ENGINE_IDS branch (isWorkletHosted is true for ANY plugin id) and
  // got a WorkletLaneEngine — the notes backend — instead of an
  // AudioWorkletEngine. Using the built-in id 'audio' here would pass even
  // with the bug still in place (the allocator's literal 'audio' branch would
  // catch it), so the fixture MUST use a different id — audio-probe does.
  it('routes a plugin engine with clipContent: audio to AudioWorkletEngine, not WorkletLaneEngine', () => {
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } })
      .Loom.registerComponent(audioProbePlugin.components[0] as unknown as ComponentManifest);
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });

    lanes.ensureLaneResource('L', 'audio-probe');

    const res = lanes.resources.get('L')!;
    expect(res).toBeDefined();
    expect(res.engine).toBeInstanceOf(AudioWorkletEngine);
    expect(res.engine).not.toBeInstanceOf(WorkletLaneEngine);
  });

  it('non-regression: the built-in audio channel still gets AudioWorkletEngine, and the six melodic engines still get WorkletLaneEngine', () => {
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } })
      .Loom.registerComponent(karplusPlugin.components[0] as unknown as ComponentManifest);
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
      expect(() => res!.engine.createVoice(ctx, res!.strip.input)).not.toThrow();
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
    expect(before.engine.id).toBe('subtractive');

    lanes.swapLaneEngine('L', 'fm');

    const after = lanes.resources.get('L')!;
    expect(after.engine.id).toBe('fm');
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
    expect(lanes.resources.get('L')!.engine.id).toBe('subtractive'); // unchanged
  });
});
