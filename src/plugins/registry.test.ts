import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPlugin, getPlugin, listPlugins, createInstance, unregisterPlugin, _resetRegistry,
} from './registry';
import type { PluginFactory } from './types';

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

  it('unregisterPlugin removes exactly the (kind, id) pair, leaving siblings untouched', () => {
    registerPlugin(fx('reverb'));
    registerPlugin(fx('delay'));
    registerPlugin(engine('reverb')); // same id, different kind — must survive
    unregisterPlugin('fx', 'reverb');
    expect(getPlugin('fx', 'reverb')).toBeUndefined();
    expect(getPlugin('fx', 'delay')).toBeDefined();
    expect(getPlugin('engine', 'reverb')).toBeDefined();
  });

  it('unregisterPlugin on an id nothing registered is a harmless no-op', () => {
    expect(() => unregisterPlugin('fx', 'ghost')).not.toThrow();
  });
});
