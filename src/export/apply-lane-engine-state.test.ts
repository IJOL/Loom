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
    const lane: SessionLane = { inserts: [],
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: {
        kitMode: 'synth',
        params: { 'bus.level': 0.8 },
        modulators: [{ kind: 'lfo' } as never],
        drumMutes: { kick: true },
      },
    };
    await applyLaneEngineState(eng as never, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument: vi.fn(), reloadPreset: vi.fn() });
    expect(eng.setKitMode).toHaveBeenCalledWith('synth');
    expect(eng.setBaseValue).toHaveBeenCalledWith('bus.level', 0.8);
    expect(eng.modulators.deserialize).toHaveBeenCalledWith(lane.engineState!.modulators);
    expect(eng.setDrumVoiceMutes).toHaveBeenCalledWith({ kick: true });
  });

  it('defaults kitMode to synth when absent', async () => {
    const eng = fakeEngine();
    const lane: SessionLane = { inserts: [], id: 'l', engineId: 'drums-machine', clips: [] };
    await applyLaneEngineState(eng as never, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument: vi.fn(), reloadPreset: vi.fn() });
    expect(eng.setKitMode).toHaveBeenCalledWith('synth');
  });

  it('awaits the drumkit reload when a drumkitId is present', async () => {
    const eng = fakeEngine();
    const reloadDrumkit = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], drumkitId: 'tr808' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit, reloadInstrument: vi.fn(), reloadPreset: vi.fn() });
    expect(reloadDrumkit).toHaveBeenCalledWith('l', 'tr808', eng);
  });

  it('reloads a melodic instrument when an instrumentId is present (no drumkitId)', async () => {
    const eng = fakeEngine();
    const reloadInstrument = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], instrumentId: 'sweep-pad' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, {
      loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument, reloadPreset: vi.fn(),
    });
    expect(reloadInstrument).toHaveBeenCalledWith('l', 'sweep-pad', eng);
  });

  it('awaits the instrument reload before setPadStore (offline ordering)', async () => {
    const eng = fakeEngine();
    let resolved = false;
    const reloadInstrument = vi.fn(async () => { resolved = true; });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], instrumentId: 'sweep-pad', padParams: { 0: { tune: 1 } } } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, {
      loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument, reloadPreset: vi.fn(),
    });
    expect(resolved).toBe(true);
    // reloadInstrument runs before setPadStore.
    const reloadOrder = reloadInstrument.mock.invocationCallOrder[0];
    const padOrder = eng.setPadStore.mock.invocationCallOrder[0];
    expect(reloadOrder).toBeLessThan(padOrder);
  });

  it('fire-and-forgets a sync instrument reload (live host)', async () => {
    const eng = fakeEngine();
    const reloadInstrument = vi.fn(() => { /* sync, returns undefined */ });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], instrumentId: 'sweep-pad' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, {
      loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument, reloadPreset: vi.fn(),
    });
    expect(reloadInstrument).toHaveBeenCalledWith('l', 'sweep-pad', eng);
  });

  it('reloads a normal preset when presetName is present (no drumkit)', async () => {
    const eng = fakeEngine();
    const reloadPreset = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], presetName: 'Sweep Pad' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, {
      loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument: vi.fn(), reloadPreset,
    });
    expect(reloadPreset).toHaveBeenCalledWith('l', 'Sweep Pad', eng);
  });

  it('mutual exclusion: presetName wins over instrumentId', async () => {
    const eng = fakeEngine();
    const reloadPreset = vi.fn(async () => { /* resolves */ });
    const reloadInstrument = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], presetName: 'Sweep Pad', instrumentId: 'sweep-pad' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, {
      loadNoteFx: vi.fn(), reloadDrumkit: vi.fn(), reloadInstrument, reloadPreset,
    });
    expect(reloadPreset).toHaveBeenCalledWith('l', 'Sweep Pad', eng);
    expect(reloadInstrument).not.toHaveBeenCalled();
  });

  it('mutual exclusion (D9): drumkitId wins, instrumentId is ignored', async () => {
    const eng = fakeEngine();
    const reloadDrumkit = vi.fn(async () => { /* resolves */ });
    const reloadInstrument = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = { inserts: [],
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], drumkitId: 'tr808', instrumentId: 'sweep-pad' } },
    };
    await applyLaneEngineState(eng as never, lane, ctx, {
      loadNoteFx: vi.fn(), reloadDrumkit, reloadInstrument, reloadPreset: vi.fn(),
    });
    expect(reloadDrumkit).toHaveBeenCalledWith('l', 'tr808', eng);
    expect(reloadInstrument).not.toHaveBeenCalled();
  });
});
