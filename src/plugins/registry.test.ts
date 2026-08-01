import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPlugin, getPlugin, listPlugins, createInstance, _resetRegistry,
} from './registry';
import type { PluginFactory } from './types';
import type { ModulatorState } from '../modulation/types';

function engine(id: string): PluginFactory {
  return {
    kind: 'engine',
    manifest: { id, name: id, kind: 'engine', version: '1.0.0', params: [], presets: [] },
    create: () => ({
      trigger: () => {}, release: () => {}, connect: () => {},
      getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {}, dispose: () => {},
    }),
  };
}

function fx(id: string): PluginFactory {
  return {
    kind: 'fx',
    manifest: { id, name: id, kind: 'fx', version: '1.0.0', params: [], presets: [] },
    create: () => ({
      input: {} as any, output: {} as any,
      getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {}, dispose: () => {},
    }),
  };
}

// Reads state.rateHz through the closure captured at create() time — the
// point of the {state, bpm} SPI is that this closure sees a LIVE reference,
// not a value snapshot, so an edit made after create() still reaches it.
function modulator(id: string): PluginFactory {
  return {
    kind: 'modulator',
    manifest: { id, name: id, kind: 'modulator', version: '1.0.0', params: [], presets: [] },
    create: (_ctx, opts) => ({
      output: {} as AudioNode,
      getAudioParams: () => new Map(),
      getBaseValue: () => opts.state.rateHz ?? 0, setBaseValue: () => {},
      applyPreset: () => {},
      dispose: () => {},
    }),
  };
}

describe('plugin registry', () => {
  beforeEach(() => _resetRegistry());

  it('register + getPlugin by (kind,id)', () => {
    const p = engine('tb303');
    registerPlugin(p);
    expect(getPlugin('engine', 'tb303')).toBe(p);
    expect(getPlugin('fx', 'tb303')).toBeUndefined();
  });

  it('listPlugins filters by kind', () => {
    registerPlugin(engine('a'));
    registerPlugin(engine('b'));
    registerPlugin(fx('reverb'));
    expect(listPlugins('engine').map((p) => p.manifest.id).sort()).toEqual(['a', 'b']);
    expect(listPlugins('fx').map((p) => p.manifest.id)).toEqual(['reverb']);
    expect(listPlugins().length).toBe(3);
  });

  it('createInstance dispatches by kind', () => {
    registerPlugin(engine('tb303'));
    const inst = createInstance('engine', 'tb303', {} as AudioContext, {} as AudioNode);
    expect(inst).toBeDefined();
    expect(typeof inst!.trigger).toBe('function');
  });

  it('createInstance returns undefined for unknown id', () => {
    expect(createInstance('engine', 'nope', {} as any, {} as any)).toBeUndefined();
  });

  it('hands a modulator plugin its live state, so an edit after create() still reaches it', () => {
    // With the old create(ctx, bpm) SPI a modulator plugin could not be handed
    // a state object at all — only a bpm number — so any modulator other than
    // the two built-ins (which bypassed the SPI entirely) came out mute.
    registerPlugin(modulator('probe'));
    const state: ModulatorState = {
      id: 'probe1', kind: 'probe', enabled: true, connections: [], scope: 'shared', rateHz: 2,
    };
    const inst = createInstance('modulator', 'probe', {} as AudioContext, { state, bpm: () => 120 });
    expect(inst).toBeDefined();

    state.rateHz = 8;
    expect(inst!.getBaseValue('rateHz')).toBe(8);
  });
});
