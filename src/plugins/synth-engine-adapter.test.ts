import { describe, it, expect } from 'vitest';
import { synthEngineAsPlugin } from './synth-engine-adapter';
import type { SynthEngine, Voice } from '../engines/engine-types';

const mockVoice: Voice = {
  trigger: () => {}, release: () => {}, connect: () => {},
  dispose: () => {}, getAudioParams: () => new Map(),
};

const mockEngine: SynthEngine = {
  id: 'mock', name: 'Mock', type: 'polyhost', polyphony: 'mono', editor: 'piano-roll',
  params: [], presets: [], modulators: {} as any,
  getBaseValue: () => 0, setBaseValue: () => {},
  createVoice: () => mockVoice,
  buildSequencer: () => ({} as any),
  buildParamUI: () => {}, applyPreset: () => {}, dispose: () => {},
};

describe('synthEngineAsPlugin', () => {
  it('produces a synth-kind factory mirroring the engine manifest', () => {
    const f = synthEngineAsPlugin(mockEngine);
    expect(f.kind).toBe('synth');
    expect(f.manifest.id).toBe('mock');
    expect(f.manifest.kind).toBe('synth');
    expect(f.manifest.version).toBe('0.0.0-legacy');
  });

  it('create() returns an instance with synth-instance methods', () => {
    const f = synthEngineAsPlugin(mockEngine);
    if (f.kind !== 'synth') throw new Error('wrong kind');
    const inst = f.create({} as AudioContext, {} as AudioNode);
    expect(typeof inst.trigger).toBe('function');
    expect(typeof inst.setBaseValue).toBe('function');
    expect(typeof inst.applyPreset).toBe('function');
  });
});
