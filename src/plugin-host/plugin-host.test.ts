import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins } from './plugin-host';
import { __resetPluginEngines } from './loom-api';
import { getEngineDescriptor } from '../engines/registry';
import { getCachedPresets, __resetPresetCache } from '../presets/preset-loader';

const MANIFEST = {
  id: 'probe', name: 'Probe', version: '1.0.0', loomApi: 1,
  main: 'main.js', dsp: 'dsp.js', presets: 'presets.json',
  components: [{
    kind: 'engine', id: 'probe', name: 'Probe', polyphony: 'poly',
    params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
    capabilities: { clipContent: 'notes', outputTrim: 0.5, shortLabel: 'probe' },
  }],
};

function fakeFetch(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(files).find((k) => String(url).endsWith(k));
    if (key === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => files[key] } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { __resetPluginEngines(); __resetPresetCache(); });

describe('loadPlugins', () => {
  it('loads a plugin listed in the index and registers its engine', async () => {
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['probe'] },
        'plugins/probe/plugin.json': MANIFEST,
        'plugins/probe/presets.json': { engineId: 'probe', presets: [{ name: 'Init', gm: [], params: {} }] },
      }),
      importImpl: async () => {
        (globalThis as unknown as { Loom: { registerComponent(m: unknown): void } })
          .Loom.registerComponent(MANIFEST.components[0]);
      },
    });
    expect(report.loaded).toEqual(['probe']);
    expect(report.failed).toEqual([]);
    expect(getEngineDescriptor('probe')?.name).toBe('Probe');
    expect(getCachedPresets('probe').map((p) => p.name)).toEqual(['Init']);
    expect(report.dspUrls.some((u) => u.endsWith('plugins/probe/dsp.js'))).toBe(true);
  });

  it('records a plugin whose module throws, and keeps loading the others', async () => {
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['boom', 'probe'] },
        'plugins/boom/plugin.json': { ...MANIFEST, id: 'boom' },
        'plugins/probe/plugin.json': MANIFEST,
      }),
      importImpl: async (url: string) => {
        if (url.includes('boom')) throw new Error('kaboom');
        (globalThis as unknown as { Loom: { registerComponent(m: unknown): void } })
          .Loom.registerComponent(MANIFEST.components[0]);
      },
    });
    expect(report.loaded).toEqual(['probe']);
    expect(report.failed).toEqual([{ id: 'boom', error: 'kaboom' }]);
  });

  it('refuses an incompatible plugin WITHOUT importing its code', async () => {
    let imported = false;
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['future'] },
        'plugins/future/plugin.json': { ...MANIFEST, id: 'future', loomApi: 99 },
      }),
      importImpl: async () => { imported = true; },
    });
    expect(imported).toBe(false);
    expect(report.failed[0].id).toBe('future');
    expect(report.failed[0].error).toContain('loomApi');
  });

  it('survives a missing index without throwing', async () => {
    const report = await loadPlugins({ baseUrl: '/', fetchImpl: fakeFetch({}), importImpl: async () => {} });
    expect(report.loaded).toEqual([]);
    expect(report.failed).toEqual([]);
  });
});
