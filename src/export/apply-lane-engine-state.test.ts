// src/export/apply-lane-engine-state.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyLaneEngineState } from './apply-lane-engine-state';
import type { SessionLane } from '../session/session';

function fakeEngine() {
  return {
    setKitMode: vi.fn(),
    setBaseValue: vi.fn(),
    modulators: { deserialize: vi.fn() },
    setKeymap: vi.fn(),
    setPadStore: vi.fn(),
    setDrumVoiceMutes: vi.fn(),
  };
}

const ctx = {} as AudioContext;

describe('applyLaneEngineState', () => {
  it('applies params, modulators, mutes via feature-detected calls', async () => {
    const eng = fakeEngine();
    const lane: SessionLane = {
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: {
        kitMode: 'synth',
        params: { 'bus.level': 0.8 },
        modulators: [{ kind: 'lfo' } as never],
        drumMutes: { kick: true },
      },
    };
    await applyLaneEngineState(eng as never, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit: vi.fn() });
    expect(eng.setKitMode).toHaveBeenCalledWith('synth');
    expect(eng.setBaseValue).toHaveBeenCalledWith('bus.level', 0.8);
    expect(eng.modulators.deserialize).toHaveBeenCalledWith(lane.engineState!.modulators);
    expect(eng.setDrumVoiceMutes).toHaveBeenCalledWith({ kick: true });
  });

  it('defaults kitMode to synth when absent', async () => {
    const eng = fakeEngine();
    const lane: SessionLane = { id: 'l', engineId: 'drums-machine', clips: [] };
    await applyLaneEngineState(eng as never, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit: vi.fn() });
    expect(eng.setKitMode).toHaveBeenCalledWith('synth');
  });

  it('awaits the drumkit reload when a drumkitId is present', async () => {
    const eng = fakeEngine();
    const reloadDrumkit = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = {
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], drumkitId: 'tr808' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit });
    expect(reloadDrumkit).toHaveBeenCalledWith('l', 'tr808', eng);
  });
});
