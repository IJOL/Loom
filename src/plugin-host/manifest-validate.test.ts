import { describe, it, expect } from 'vitest';
import { validatePluginManifest } from './manifest-validate';

const engineComponent = {
  kind: 'engine' as const,
  id: 'karplus', name: 'Karplus', polyphony: 'poly' as const,
  params: [{ id: 'a', label: 'A', kind: 'continuous' as const, min: 0, max: 1, default: 0 }],
  capabilities: { clipContent: 'notes' as const, shortLabel: 'karp', outputTrim: 0.857 },
};
const modulatorComponent = {
  kind: 'modulator' as const,
  id: 'sh', name: 'S&H',
  params: [{ id: 'rate', label: 'Rate', kind: 'continuous' as const, min: 0.1, max: 20, default: 6 }],
  modulator: { driver: 'time' as const, scopes: ['shared' as const, 'per-voice' as const], idPrefix: 'sh' },
};
const ok = (over: Record<string, unknown> = {}) => ({
  id: 'p', name: 'P', version: '1.0.0', loomApi: 1, main: 'main.js',
  components: [engineComponent], ...over,
});
const fxManifest = (fx: unknown) => ({
  id: 'wah', name: 'Wah', version: '1.0.0', loomApi: 1, main: 'main.js',
  components: [{ kind: 'fx', id: 'wah', name: 'Auto-Wah', params: [], fx }],
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

  it('accepts a component that declares a groups table with a matching param group', () => {
    const withGroups = {
      ...engineComponent,
      params: [{ ...engineComponent.params[0], group: 'osc' }],
      groups: [{ id: 'osc', title: 'OSC', row: 0, color: 'var(--knob-cyan)' }],
    };
    const r = validatePluginManifest(ok({ components: [withGroups] }));
    expect(r.ok).toBe(true);
  });

  it('rejects a groups table that is not an array', () => {
    const bad = ok({ components: [{ ...engineComponent, groups: { id: 'osc' } }] });
    const r = validatePluginManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('groups');
  });

  it('rejects a group entry missing a title', () => {
    const bad = ok({ components: [{ ...engineComponent, groups: [{ id: 'osc' }] }] });
    const r = validatePluginManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('title');
  });

  it('rejects a param whose group is not a string', () => {
    const bad = ok({ components: [{ ...engineComponent, params: [{ ...engineComponent.params[0], group: 3 }] }] });
    const r = validatePluginManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('group');
  });

  it('leaves optional capabilities absent so the READER can apply the defaults', () => {
    const r = validatePluginManifest(ok());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.manifest.components![0];
      if (c.kind !== 'engine') throw new Error('expected an engine component');
      // Absent in the JSON: the READER applies the defaults, not the validator.
      expect(c.capabilities.acceptsNoteFx).toBeUndefined();
    }
  });

  it('accepts a well-formed modulator component', () => {
    const r = validatePluginManifest(ok({ components: [modulatorComponent] }));
    expect(r.ok).toBe(true);
  });

  it('rejects a modulator component with a bad driver', () => {
    const bad = { ...modulatorComponent, modulator: { ...modulatorComponent.modulator, driver: 'clock' } };
    const r = validatePluginManifest(ok({ components: [bad] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('driver');
  });

  it('rejects a modulator component with an empty scopes array', () => {
    const bad = { ...modulatorComponent, modulator: { ...modulatorComponent.modulator, scopes: [] } };
    const r = validatePluginManifest(ok({ components: [bad] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('scopes');
  });

  it('rejects a modulator component with no idPrefix', () => {
    const modulator = { ...modulatorComponent.modulator } as Record<string, unknown>;
    delete modulator.idPrefix;
    const r = validatePluginManifest(ok({ components: [{ ...modulatorComponent, modulator }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('idPrefix');
  });

  it('rejects a modulator component with no modulator declaration at all', () => {
    const bad = { ...modulatorComponent } as Record<string, unknown>;
    delete bad.modulator;
    const r = validatePluginManifest(ok({ components: [bad] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('modulator');
  });

  it('accepts an fx component that declares its colour', () => {
    expect(validatePluginManifest(fxManifest({ color: '#ffa726' })).ok).toBe(true);
  });

  it('rejects an fx component with no fx block', () => {
    const res = validatePluginManifest(fxManifest(undefined));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/needs an fx object/);
  });

  it('rejects an fx component whose colour is missing', () => {
    const res = validatePluginManifest(fxManifest({}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fx\.color/);
  });

  it('accepts a manifest with no main: a plugin may be pure data', () => {
    const res = validatePluginManifest({
      id: 'nomain', name: 'No Main', version: '1.0.0', loomApi: 1,
      components: [{
        kind: 'modulator', id: 'nomain', name: 'No Main', params: [],
        modulator: { driver: 'time', scopes: ['shared'], idPrefix: 'nm' },
      }],
    });
    expect(res.ok).toBe(true);
  });

  it('still rejects a main that is present but not a string', () => {
    const res = validatePluginManifest({
      id: 'badmain', name: 'Bad', version: '1.0.0', loomApi: 1, main: 42,
      components: [],
    });
    expect(res.ok).toBe(false);
  });
});

// WEAVE is a panel: it makes no sound, modulates nothing and processes no
// audio, and its controls are a two-axis pad, a cursor over a queue and a row
// of bars — none of which is a single number. Both shapes are refused today.
// Pinning the refusals here means the phases that widen them change a
// documented answer rather than an assumed one.
describe('what the manifest refuses today (pinned before WEAVE widens it)', () => {
  const base = { id: 'x', name: 'X', version: '1.0.0', loomApi: 1, components: [] as unknown[] };

  // `panel` used to sit here. Phase 1 opened it, so the pin moves to a kind
  // that is still closed — the guard has to keep refusing what it never knew,
  // not merely stop refusing the one thing we wanted.
  it('rejects a component kind the host does not have', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{ kind: 'sampler', id: 'p', name: 'P', params: [] }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/kind must be engine\|modulator\|fx\|panel/);
  });

  it('accepts a panel component', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{
        kind: 'panel', id: 'weave', name: 'Weave',
        params: [], panel: { placement: 'main-view' },
      }],
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a panel with a placement the host has nowhere to put', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{
        kind: 'panel', id: 'weave', name: 'Weave',
        params: [], panel: { placement: 'floating' },
      }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/placement must be main-view/);
  });

  it('rejects a panel that declares no panel object at all', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{ kind: 'panel', id: 'weave', name: 'Weave', params: [] }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/needs a panel object/);
  });

  // This one is NOT a pin waiting to be opened. A param is one number, and a
  // component that needs a control shaped otherwise asks for it at runtime
  // through Loom.controls and places it in its own DOM zone. Declaring widget
  // shapes here was tried and reverted: the manifest can describe params but
  // not an ARRANGEMENT, so a panel needs the zone regardless — and the extra
  // kinds would have been permanent vocabulary serving one plugin.
  it('rejects a param kind that is not continuous|discrete', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{
        kind: 'fx', id: 'f', name: 'F', fx: { color: '#fff' },
        params: [{ id: 'p', label: 'P', kind: 'pad2d', min: 0, max: 1, default: 0 }],
      }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/kind must be continuous\|discrete/);
  });
});
