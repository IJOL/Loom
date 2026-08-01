import { describe, it, expect } from 'vitest';
import { validatePluginManifest } from './manifest-validate';

const engineComponent = {
  kind: 'engine' as const,
  id: 'karplus', name: 'Karplus', polyphony: 'poly' as const,
  params: [{ id: 'a', label: 'A', kind: 'continuous' as const, min: 0, max: 1, default: 0 }],
  capabilities: { clipContent: 'notes' as const, shortLabel: 'karp', outputTrim: 0.857 },
};
const ok = (over: Record<string, unknown> = {}) => ({
  id: 'p', name: 'P', version: '1.0.0', loomApi: 1, main: 'main.js',
  components: [engineComponent], ...over,
});

describe('validatePluginManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = validatePluginManifest(ok());
    expect(r.ok).toBe(true);
  });

  it('rejects a manifest built for a different API version', () => {
    const r = validatePluginManifest(ok({ loomApi: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('loomApi');
  });

  it('rejects a manifest with no id', () => {
    const r = validatePluginManifest(ok({ id: '' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a component whose param spec is malformed', () => {
    const bad = ok({ components: [{ ...engineComponent, params: [{ id: 'x' }] }] });
    const r = validatePluginManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('params');
  });

  it('rejects a component with no outputTrim, rather than guessing one', () => {
    const caps = { ...engineComponent.capabilities } as Record<string, unknown>;
    delete caps.outputTrim;
    const r = validatePluginManifest(ok({ components: [{ ...engineComponent, capabilities: caps }] }));
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validatePluginManifest(null).ok).toBe(false);
    expect(validatePluginManifest('nope').ok).toBe(false);
  });

  it('rejects the OLD shape loudly instead of registering nothing', () => {
    // Without `components`, an old-shape manifest would validate and register
    // ZERO components: the plugin would load and its engine would vanish from
    // the selector without a single message. That's why `components` is required.
    const oldShape = {
      id: 'p', name: 'P', version: '1.0.0', loomApi: 1, main: 'main.js',
      engines: [{ id: 'x', name: 'X' }],
    };
    const r = validatePluginManifest(oldShape);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/components/);
  });

  it('accepts clipContent audio', () => {
    const caps = { ...engineComponent.capabilities, clipContent: 'audio' as const };
    expect(validatePluginManifest(ok({ components: [{ ...engineComponent, capabilities: caps }] })).ok).toBe(true);
  });

  it('rejects an unknown component kind', () => {
    const r = validatePluginManifest(ok({ components: [{ ...engineComponent, kind: 'wat' }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/kind/);
  });

  it('rejects an accepts entry that is not a known asset kind', () => {
    const caps = { ...engineComponent.capabilities, accepts: ['midi-file'] };
    const r = validatePluginManifest(ok({ components: [{ ...engineComponent, capabilities: caps }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/accepts/);
  });

  it('leaves optional capabilities absent so the READER can apply the defaults', () => {
    const r = validatePluginManifest(ok());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.manifest.components![0];
      // Absent in the JSON: the READER applies the defaults, not the validator.
      expect(c.capabilities.acceptsNoteFx).toBeUndefined();
    }
  });
});
