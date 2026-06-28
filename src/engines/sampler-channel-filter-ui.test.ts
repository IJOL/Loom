// @vitest-environment jsdom
// DOM tests for the sampler CHANNEL FILTER UI section (Task 11).
// Kept separate from sampler-worklet-engine.test.ts which runs in the node
// environment (no `document`) for DSP and scheduling assertions.
import { describe, it, expect } from 'vitest';
import '../../test/setup';

const loaded: string[] = [];

import { vi } from 'vitest';
vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    loadSample(id: string) { loaded.push(id); }
    hasSample() { return false; }
    spawn() {}
    silenceAll() {}
    connectDry() {}
    connectSend() {}
    disconnect() {}
  },
}));

import { SamplerWorkletEngine } from './sampler-worklet-engine';

const ctx = new AudioContext();
const out = () => ctx.createGain();

describe('SamplerWorkletEngine — CHANNEL FILTER UI', () => {
  it('renders a labelled CHANNEL FILTER section with CUTOFF + RES knobs registered under the lane', () => {
    const eng = new SamplerWorkletEngine();
    const container = document.createElement('div');
    const registered: string[] = [];
    const ctx2 = {
      laneId: 'sampler-1',
      registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
      registry: new Map(),
      lookupLaneDisplayName: () => undefined,
    } as never;
    eng.buildParamUI(container, ctx2);
    expect(container.textContent).toContain('CHANNEL FILTER');
    expect(registered).toContain('sampler-1.filter.cutoff');
    expect(registered).toContain('sampler-1.filter.resonance');
    // The generic global knob row must NOT also render the filter knobs (no dup).
    const dupCutoff = registered.filter((id) => id === 'sampler-1.filter.cutoff');
    expect(dupCutoff).toHaveLength(1);
  });

  it('renders the MODULATORS panel so the filter can be routed to an LFO/ADSR', () => {
    const eng = new SamplerWorkletEngine();
    eng.createVoice(ctx, out());
    const container = document.createElement('div');
    const ctx2 = {
      laneId: 'sampler-1',
      registerKnob: (_k: { meta?: { id?: string } }) => {},
      registry: new Map(),
      lookupLaneDisplayName: () => undefined,
    } as never;
    eng.buildParamUI(container, ctx2);
    expect(container.textContent).toContain('MODULATORS');
  });
});
