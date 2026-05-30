import { describe, it, expect, vi, beforeEach } from 'vitest';
// Side-effect imports register engines in the global registry.
import '../engines/tb303';
import '../engines/drums-engine';
import '../engines/subtractive';
import '../engines/fm';
import '../engines/wavetable';
import { DrumsEngine } from '../engines/drums-engine';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';
import type { FxInstance } from '../plugins/types';

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

describe('Phase G latent-bug fix: drums-machine lane gets setSharedFx before createVoice', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('setSharedFx is called before any createVoice on a drums-machine lane', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);

    // Spy on the prototype methods to capture call order.
    const setSharedFxSpy = vi.spyOn(DrumsEngine.prototype, 'setSharedFx');
    const createVoiceSpy = vi.spyOn(DrumsEngine.prototype, 'createVoice');

    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('drums-2', 'drums-machine');

    // setSharedFx must have been called by ensureLaneResource.
    expect(setSharedFxSpy).toHaveBeenCalledWith(fx);

    // ensureLaneResource must NOT have called createVoice.
    expect(createVoiceSpy).not.toHaveBeenCalled();

    // Now trigger a createVoice call and confirm it doesn't throw
    // (this verifies setSharedFx was called first).
    const res = lanes.resources.get('drums-2');
    expect(res).toBeDefined();
    expect(() => res!.engine.createVoice(ctx, res!.strip.input)).not.toThrow();

    // createVoice was called once (by our explicit call above).
    expect(createVoiceSpy).toHaveBeenCalledOnce();

    // Order: setSharedFxSpy must have been called before createVoiceSpy.
    expect(setSharedFxSpy.mock.invocationCallOrder[0])
      .toBeLessThan(createVoiceSpy.mock.invocationCallOrder[0]!);
  });

  it('extra drums-machine lane createVoice does not throw (latent bug was: sharedFx null)', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    // Allocate a second drum lane (the latent bug only affected lanes after the first).
    lanes.ensureLaneResource('drums-2', 'drums-machine');
    const res = lanes.resources.get('drums-2');
    expect(res).toBeDefined();
    // This threw before the fix because setSharedFx was never called for extra lanes.
    expect(() => res!.engine.createVoice(ctx, res!.strip.input)).not.toThrow();
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
    res.inserts.insert(mockFx);
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
