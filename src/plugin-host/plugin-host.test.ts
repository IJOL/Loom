import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins } from './plugin-host';
import { __resetPluginEngines } from './loom-api';
import { getEngineDescriptor } from '../engines/registry';
import { getCachedPresets, __resetPresetCache } from '../presets/preset-loader';
import { getModulator, __resetModulators } from '../modulation/modulator-registry';

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

beforeEach(() => { __resetPluginEngines(); __resetPresetCache(); __resetModulators(); });

describe('loadPlugins', () => {
  it('loads a plugin listed in the index and registers its engine', async () => {
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['probe'] },
        'plugins/probe/plugin.json': MANIFEST,
        'plugins/probe/presets.json': { engineId: 'probe', presets: [{ name: 'Init', gm: [], params: {} }] },
      }),
      // Nothing to do: adoptComponents already registered the engine from the
      // manifest before this ran. main.js no longer carries the component.
      importImpl: async () => {},
    });
    expect(report.loaded).toEqual(['probe']);
    expect(report.failed).toEqual([]);
    expect(getEngineDescriptor('probe')?.name).toBe('Probe');
    expect(getCachedPresets('probe').map((p) => p.name)).toEqual(['Init']);
    expect(report.dspUrls.some((u) => u.endsWith('plugins/probe/dsp.js'))).toBe(true);
  });

  it('records a plugin whose module throws, and keeps loading the others', async () => {
    // Its own component id (NOT 'probe', MANIFEST's): reusing 'probe' would
    // make it impossible to tell "boom's component was rolled back" apart
    // from "boom's component never had its own registration to check" —
    // the probe plugin below would keep the id alive either way.
    const BOOM = {
      ...MANIFEST, id: 'boom',
      components: [{
        kind: 'engine', id: 'boom-engine', name: 'Boom', polyphony: 'poly',
        params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
        capabilities: { clipContent: 'notes', outputTrim: 0.5, shortLabel: 'boom' },
      }],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['boom', 'probe'] },
        'plugins/boom/plugin.json': BOOM,
        'plugins/probe/plugin.json': MANIFEST,
      }),
      importImpl: async (url: string) => {
        if (url.includes('boom')) throw new Error('kaboom');
      },
    });
    expect(report.loaded).toEqual(['probe']);
    expect(report.failed).toEqual([{ id: 'boom', error: 'kaboom' }]);
    // The whole point of the rollback: adoptComponents ran (above the
    // import, unconditionally) before main.js threw, so without a rollback
    // boom-engine would still be sitting in the registry — visible in the
    // lane selector with no DSP behind it. It must be gone.
    expect(getEngineDescriptor('boom-engine')).toBeUndefined();
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

  it('registers a component from the validated plugin.json, with no help from main.js', async () => {
    const manifest = {
      id: 'jsonly', name: 'JSON Only', version: '1.0.0', loomApi: 1,
      components: [{
        kind: 'modulator', id: 'jsonly', name: 'JSON Only', params: [],
        modulator: { driver: 'time', scopes: ['shared'], idPrefix: 'jo' },
      }],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: (async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('index.json') ? { plugins: ['jsonly'] } : manifest),
      })) as unknown as typeof fetch,
      // No main in the manifest, so this must never be reached.
      importImpl: async () => { throw new Error('main.js must not be imported'); },
    });
    expect(report.loaded).toEqual(['jsonly']);
    expect(getModulator('jsonly')).toBeDefined();
  });
});
