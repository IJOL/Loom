import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, __resetPluginEngines } from './loom-api';
import { getEngineDescriptor } from '../engines/registry';
import { engineCapabilities } from '../plugins/capabilities';
import { LOOM_API_VERSION, type ComponentManifest } from '@loom/plugin-sdk';

const manifest: ComponentManifest = {
  kind: 'engine', id: 'probe', name: 'Probe', polyphony: 'poly',
  params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
  capabilities: { clipEditor: 'piano-roll', outputTrim: 0.5, shortLabel: 'probe' },
};

describe('the main-thread Loom API', () => {
  beforeEach(() => { __resetPluginEngines(); installMainThreadLoomApi(); });

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
});
