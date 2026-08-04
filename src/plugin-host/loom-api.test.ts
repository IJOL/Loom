import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, __resetPluginEngines, adoptComponents } from './loom-api';
import { getEngineDescriptor, listEngines } from '../engines/registry';
import { engineCapabilities } from '../plugins/capabilities';
import { getModulator, __resetModulators } from '../modulation/modulator-registry';
import { __resetModulatorKernels, getModulatorKernel } from '../audio-dsp/modulator-kernels';
import { LOOM_API_VERSION, type ComponentManifest } from '@loom/plugin-sdk';

const manifest: ComponentManifest = {
  kind: 'engine', id: 'probe', name: 'Probe', polyphony: 'poly',
  params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
  capabilities: { clipContent: 'notes', outputTrim: 0.5, shortLabel: 'probe' },
};

const modulatorManifest: ComponentManifest = {
  kind: 'modulator', id: 'sh', name: 'S&H',
  params: [{ id: 'rate', label: 'Rate', kind: 'continuous', min: 0.1, max: 20, default: 6 }],
  modulator: { driver: 'time', scopes: ['shared', 'per-voice'], idPrefix: 'sh' },
};

const fxManifest: ComponentManifest = {
  kind: 'fx', id: 'wah', name: 'Auto-Wah', params: [],
  fx: { color: '#ffa726' },
};

describe('the main-thread Loom API', () => {
  beforeEach(() => {
    __resetPluginEngines();
    __resetModulators();
    __resetModulatorKernels();
    installMainThreadLoomApi();
  });

  it('publishes its API version', () => {
    expect((globalThis as unknown as { Loom: { apiVersion: number } }).Loom.apiVersion).toBe(LOOM_API_VERSION);
  });

  it('turns a registered component manifest into a real engine descriptor', () => {
    adoptComponents([manifest]);
    const d = getEngineDescriptor('probe');
    expect(d?.name).toBe('Probe');
    expect(d?.polyphony).toBe('poly');
    // The engine's own param plus the seven the channel strip contributes to
    // every lane — so a plugin engine is automatable exactly like a built-in.
    expect(d?.params.length).toBeGreaterThan(1);
    expect(d?.params.some((p) => p.id === 'amp.level')).toBe(true);
  });

  it('feeds the capability door so readers can answer without the engine id', () => {
    adoptComponents([manifest]);
    expect(engineCapabilities('probe')?.outputTrim).toBe(0.5);
  });

  it('carries a declared groups table onto the registered engine, exactly like params', () => {
    const withGroups: ComponentManifest = {
      ...manifest,
      id: 'probe-grouped',
      params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8, group: 'amp' }],
      groups: [{ id: 'amp', title: 'AMP', row: 0, color: 'var(--knob-purple)' }],
    };
    adoptComponents([withGroups]);
    const d = getEngineDescriptor('probe-grouped');
    expect(d?.groups?.map((g) => g.title)).toEqual(['AMP']);
    expect(d?.groups?.[0].color).toBe('var(--knob-purple)');
  });

  it('is idempotent — installing twice keeps one object', () => {
    const first = (globalThis as unknown as { Loom: unknown }).Loom;
    installMainThreadLoomApi();
    expect((globalThis as unknown as { Loom: unknown }).Loom).toBe(first);
  });

  it('registers a modulator component as a modulator, not as an engine', () => {
    adoptComponents([modulatorManifest]);
    expect(getModulator('sh')?.name).toBe('S&H');
    // The bug this fixes: adoptComponent never read m.kind, so ANY component
    // was registered as an engine and would show up in the engine selector.
    expect(listEngines().map((e) => e.id)).not.toContain('sh');
  });

  it("a plugin modulator's defaultState seeds params from the declared defaults and takes scopes[0]", () => {
    adoptComponents([modulatorManifest]);
    const state = getModulator('sh')!.defaultState('sh1');
    expect(state.scope).toBe('shared');
    expect(state.params).toEqual({ rate: 6 });
  });

  it("a plugin modulator's createVoice is a silent placeholder, not a throw", () => {
    adoptComponents([modulatorManifest]);
    const ctx = new AudioContext();
    const state = getModulator('sh')!.defaultState('sh1');
    const voice = getModulator('sh')!.createVoice(ctx, { state, bpm: () => 120 });
    expect(voice.output).toBeInstanceOf(AudioNode);
    expect(voice.currentValue()).toBe(0);
    expect(() => voice.trigger(0, { gateDuration: 0.1 })).not.toThrow();
    expect(() => voice.dispose()).not.toThrow();
  });

  it('opens the kernel door: a plugin kernel registered through Loom lands in the shared registry', () => {
    (globalThis as unknown as { Loom: { registerModulatorKernel(k: unknown): void } })
      .Loom.registerModulatorKernel({ id: 'sh', valueAt: () => 0.5 });
    expect(getModulatorKernel('sh')?.valueAt({} as never, 0, 0)).toBe(0.5);
  });

  // adoptComponents must never half-install: a component that fails midway
  // through its own registration, or a manifest where a LATER component
  // fails after an EARLIER one already succeeded, must leave nothing behind.
  // No real manifest reaches these — validatePluginManifest requires `params`
  // — so `params: undefined` here simulates the one call adoptEngine cannot
  // itself guard against (a bug elsewhere in the pipeline, or a future
  // component kind), the same way the two "malformed" cases below assert the
  // mechanism directly rather than waiting for a live plugin to trip it.
  it('rolls back everything a malformed engine component partially registered before it threw', () => {
    const malformed = { ...manifest, id: 'malformed', params: undefined } as unknown as ComponentManifest;
    expect(() => adoptComponents([malformed])).toThrow();
    expect(getEngineDescriptor('malformed')).toBeUndefined();
    expect(engineCapabilities('malformed')).toBeUndefined();
  });

  it('rolls back an EARLIER component in the same manifest when a LATER one throws', () => {
    const good: ComponentManifest = { ...manifest, id: 'rollback-good' };
    const malformed = { ...manifest, id: 'rollback-bad', params: undefined } as unknown as ComponentManifest;
    expect(() => adoptComponents([good, malformed])).toThrow();
    // The whole point: whatever ran before the throw must not survive it.
    expect(getEngineDescriptor('rollback-good')).toBeUndefined();
    expect(getEngineDescriptor('rollback-bad')).toBeUndefined();
  });

  // An fx component's factory arrives later, through Loom.registerFx (a later
  // task) — this build has no way to adopt one from the manifest alone. A
  // silent no-op here would be exactly the half-installed failure this whole
  // file exists to prevent: the manifest validates, the plugin "loads", and
  // nothing says the insert is not actually there. It must throw instead.
  it('refuses to adopt an fx component — Loom.registerFx (a later task) is the only real door', () => {
    expect(() => adoptComponents([fxManifest])).toThrow(/cannot adopt/);
  });

  it('rolls back an engine adopted before a LATER fx component throws', () => {
    const good: ComponentManifest = { ...manifest, id: 'rollback-fx-good' };
    expect(() => adoptComponents([good, fxManifest])).toThrow();
    expect(getEngineDescriptor('rollback-fx-good')).toBeUndefined();
  });
});
