// src/app/plugin-bootstrap.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapPlugins } from './plugin-bootstrap';
import { listPlugins, _resetRegistry } from '../plugins/registry';

describe('bootstrapPlugins', () => {
  beforeEach(() => _resetRegistry());

  it('registers all built-in synth engines as plugins', () => {
    bootstrapPlugins();
    const ids = listPlugins('synth').map((p) => p.manifest.id);
    // The six core engines must always be present; additional plugin files
    // discovered via import.meta.glob may appear too.
    const CORE = ['drums-machine', 'fm', 'karplus', 'subtractive', 'tb303', 'wavetable'];
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
    expect(listPlugins('fx').map((p) => p.manifest.id).sort()).toEqual(['compressor', 'delay', 'distortion', 'limiter', 'multifilter', 'noop', 'reverb']);
  });
});
