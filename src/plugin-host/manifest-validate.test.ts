import { describe, it, expect } from 'vitest';
import { validatePluginManifest } from './manifest-validate';

const good = {
  id: 'karplus', name: 'Karp', version: '1.0.0', loomApi: 1,
  main: 'main.js', dsp: 'dsp.js', presets: 'presets.json',
  engines: [{
    id: 'karplus', name: 'Karp', polyphony: 'poly', clipEditor: 'piano-roll',
    outputTrim: 0.857, shortLabel: 'karplus',
    params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
  }],
};

describe('validatePluginManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = validatePluginManifest(good);
    expect(r.ok).toBe(true);
  });

  it('rejects a manifest built for a different API version', () => {
    const r = validatePluginManifest({ ...good, loomApi: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('loomApi');
  });

  it('rejects a manifest with no id', () => {
    const r = validatePluginManifest({ ...good, id: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects an engine whose param spec is malformed', () => {
    const bad = { ...good, engines: [{ ...good.engines[0], params: [{ id: 'x' }] }] };
    const r = validatePluginManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('params');
  });

  it('rejects an engine with no outputTrim, rather than guessing one', () => {
    const e = { ...good.engines[0] } as Record<string, unknown>;
    delete e.outputTrim;
    const r = validatePluginManifest({ ...good, engines: [e] });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validatePluginManifest(null).ok).toBe(false);
    expect(validatePluginManifest('nope').ok).toBe(false);
  });
});
