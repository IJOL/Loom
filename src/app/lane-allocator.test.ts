import { describe, it, expect, vi, beforeEach } from 'vitest';
// Side-effect imports register engines in the global registry.
import '../engines/tb303';
import '../engines/drums-engine';
import '../engines/subtractive';
import { DrumsEngine } from '../engines/drums-engine';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';

function makeCtx() {
  return new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
}

function makeDeps(ctx: AudioContext) {
  const master = ctx.createGain();
  const fx = new FxBus(ctx, master);
  const sidechainBus = new SidechainBus();
  return { ctx, master, fx, sidechainBus };
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
