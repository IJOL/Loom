import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, __resetPluginEngines } from './loom-api';
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
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } }).Loom.registerComponent(manifest);
    const d = getEngineDescriptor('probe');
    expect(d?.name).toBe('Probe');
    expect(d?.polyphony).toBe('poly');
    // The engine's own param plus the seven the channel strip contributes to
    // every lane — so a plugin engine is automatable exactly like a built-in.
    expect(d?.params.length).toBeGreaterThan(1);
    expect(d?.params.some((p) => p.id === 'amp.level')).toBe(true);
  });

  it('feeds the capability door so readers can answer without the engine id', () => {
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } }).Loom.registerComponent(manifest);
    expect(engineCapabilities('probe')?.outputTrim).toBe(0.5);
  });

  it('is idempotent — installing twice keeps one object', () => {
    const first = (globalThis as unknown as { Loom: unknown }).Loom;
    installMainThreadLoomApi();
    expect((globalThis as unknown as { Loom: unknown }).Loom).toBe(first);
  });

  it('registers a modulator component as a modulator, not as an engine', () => {
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } })
      .Loom.registerComponent(modulatorManifest);
    expect(getModulator('sh')?.name).toBe('S&H');
    // The bug this fixes: adoptComponent never read m.kind, so ANY component
    // was registered as an engine and would show up in the engine selector.
    expect(listEngines().map((e) => e.id)).not.toContain('sh');
  });

  it("a plugin modulator's defaultState seeds params from the declared defaults and takes scopes[0]", () => {
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } })
      .Loom.registerComponent(modulatorManifest);
    const state = getModulator('sh')!.defaultState('sh1');
    expect(state.scope).toBe('shared');
    expect(state.params).toEqual({ rate: 6 });
  });

  it("a plugin modulator's createVoice is a silent placeholder, not a throw", () => {
    (globalThis as unknown as { Loom: { registerComponent(m: ComponentManifest): void } })
      .Loom.registerComponent(modulatorManifest);
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
});
