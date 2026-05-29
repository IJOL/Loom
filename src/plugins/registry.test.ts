import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPlugin, getPlugin, listPlugins, createInstance, _resetRegistry,
} from './registry';
import type { PluginFactory } from './types';

function synth(id: string): PluginFactory {
  return {
    kind: 'synth',
    manifest: { id, name: id, kind: 'synth', version: '1.0.0', params: [], presets: [] },
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

describe('plugin registry', () => {
  beforeEach(() => _resetRegistry());

  it('register + getPlugin by (kind,id)', () => {
    const p = synth('tb303');
    registerPlugin(p);
    expect(getPlugin('synth', 'tb303')).toBe(p);
    expect(getPlugin('fx', 'tb303')).toBeUndefined();
  });

  it('listPlugins filters by kind', () => {
    registerPlugin(synth('a'));
    registerPlugin(synth('b'));
    registerPlugin(fx('reverb'));
    expect(listPlugins('synth').map((p) => p.manifest.id).sort()).toEqual(['a', 'b']);
    expect(listPlugins('fx').map((p) => p.manifest.id)).toEqual(['reverb']);
    expect(listPlugins().length).toBe(3);
  });

  it('createInstance dispatches by kind', () => {
    registerPlugin(synth('tb303'));
    const inst = createInstance('synth', 'tb303', {} as AudioContext, {} as AudioNode);
    expect(inst).toBeDefined();
    expect(typeof inst!.trigger).toBe('function');
  });

  it('createInstance returns undefined for unknown id', () => {
    expect(createInstance('synth', 'nope', {} as any, {} as any)).toBeUndefined();
  });
});
