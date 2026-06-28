import { describe, it, expect, vi } from 'vitest';
import '../../test/setup';
import { applyLaneEngineState } from '../export/apply-lane-engine-state';
import { DrumsWorkletEngine } from './drums-worklet-engine';

vi.mock('../audio-worklet/drums-node', () => ({
  loadDrumsWorklet: vi.fn().mockResolvedValue(undefined),
  DrumsWorkletNode: class { hit(){} setVoiceParams(){} connectVoice(){} disconnect(){} },
}));

vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class { postMessage(){} loadSample(){} disconnect(){} },
}));

const noopDeps = {
  loadNoteFx: () => {},
  reloadDrumkit: () => {},
  reloadInstrument: () => {},
};

describe('channel filter persistence round-trip', () => {
  it('drums: a saved non-default cutoff/resonance reloads with those exact values', async () => {
    const eng = new DrumsWorkletEngine();
    const lane = {
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: { params: { 'filter.cutoff': 640, 'filter.resonance': 9 } },
    } as never;
    await applyLaneEngineState(eng as never, lane, {} as AudioContext, noopDeps as never);
    expect(eng.getBaseValue('filter.cutoff')).toBeCloseTo(640, 3);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(9, 3);
  });

  it('drums: absent params fall back to the open/min defaults (older saves unchanged)', async () => {
    const eng = new DrumsWorkletEngine();
    const lane = { id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: {} } as never;
    await applyLaneEngineState(eng as never, lane, {} as AudioContext, noopDeps as never);
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(0.7, 5);
  });

  it('sampler: a saved non-default cutoff/resonance reloads with those exact values', async () => {
    const { SamplerWorkletEngine } = await import('./sampler-worklet-engine');
    const eng = new SamplerWorkletEngine();
    const lane = {
      id: 'sampler-1', engineId: 'sampler', clips: [],
      engineState: { params: { 'filter.cutoff': 1200, 'filter.resonance': 5 } },
    } as never;
    await applyLaneEngineState(eng as never, lane, {} as AudioContext, noopDeps as never);
    expect(eng.getBaseValue('filter.cutoff')).toBeCloseTo(1200, 3);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(5, 3);
  });

  it('sampler: absent params fall back to the open/min defaults (older saves unchanged)', async () => {
    const { SamplerWorkletEngine } = await import('./sampler-worklet-engine');
    const eng = new SamplerWorkletEngine();
    const lane = { id: 'sampler-1', engineId: 'sampler', clips: [], engineState: {} } as never;
    await applyLaneEngineState(eng as never, lane, {} as AudioContext, noopDeps as never);
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(0.7, 5);
  });
});
