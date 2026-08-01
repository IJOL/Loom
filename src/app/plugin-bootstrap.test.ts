// src/app/plugin-bootstrap.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapPlugins } from './plugin-bootstrap';
import { registerPlugin, listPlugins, _resetRegistry } from '../plugins/registry';

describe('bootstrapPlugins', () => {
  beforeEach(() => _resetRegistry());

  it('registers all built-in synth engines as plugins', () => {
    bootstrapPlugins();
    const ids = listPlugins('engine').map((p) => p.manifest.id);
    // The core BUILT-IN engines must always be present; additional plugin files
    // discovered via import.meta.glob may appear too.
    //
    // A runtime plugin is deliberately NOT in this list: bootstrapPlugins is the
    // build-time glob over src/, and a plugin arrives later through loadPlugins
    // (see plugin-host.test.ts). The plucked string left this list when it became
    // one — registering its manifest here would not put it in listPlugins('engine')
    // either, because that registry is the glob's, not the engine registry's.
    const CORE = ['drums-machine', 'fm', 'subtractive', 'tb303', 'wavetable'];
    for (const id of CORE) expect(ids).toContain(id);
  });

  it('accepts and registers extras', () => {
    bootstrapPlugins([{
      kind: 'fx',
      manifest: { id: 'noop', name: 'noop', kind: 'fx', version: '1.0.0', params: [], presets: [] },
      create: () => ({
        input: {} as any, output: {} as any,
        getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
        applyPreset: () => {}, dispose: () => {},
      }),
    }]);
    expect(listPlugins('fx').map((p) => p.manifest.id).sort()).toEqual(['bitcrusher', 'chorus', 'compressor', 'delay', 'distortion', 'flanger', 'limiter', 'multifilter', 'noop', 'phaser', 'reverb', 'tremolo']);
  });

  it('lists an engine component under the kind the rest of the app uses', () => {
    // The two registries used different names for the same thing. This test pins
    // which one wins, so there is never a second one again.
    _resetRegistry();
    registerPlugin({
      kind: 'engine',
      manifest: { id: 'probe', name: 'Probe', kind: 'engine', version: '1.0.0', params: [], presets: [] },
      create: () => { throw new Error('not built in this test'); },
    } as never);
    expect(listPlugins('engine').map((p) => p.manifest.id)).toEqual(['probe']);
  });
});
