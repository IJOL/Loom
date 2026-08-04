import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins } from './plugin-host';
import { __resetPluginEngines } from './loom-api';
import { getEngineDescriptor } from '../engines/registry';
import { getCachedPresets, __resetPresetCache } from '../presets/preset-loader';
import { getModulator, __resetModulators } from '../modulation/modulator-registry';
import { getPlugin, registerPlugin, _resetRegistry } from '../plugins/registry';
import type { FxInstance } from '@loom/plugin-sdk';

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

beforeEach(() => { __resetPluginEngines(); __resetPresetCache(); __resetModulators(); _resetRegistry(); });

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

  it('a plugin that declares an fx and registers no factory is a load failure', async () => {
    const manifest = {
      id: 'broken', name: 'Broken', version: '1.0.0', loomApi: 1, main: 'main.js',
      components: [{ kind: 'fx', id: 'broken', name: 'Broken', params: [], fx: { color: '#f00' } }],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: (async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('index.json') ? { plugins: ['broken'] } : manifest),
      })) as unknown as typeof fetch,
      importImpl: async () => undefined,   // main.js runs and registers nothing
    });
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].error).toMatch(/declared fx component/);
    // And it is NOT in the picker: a dead entry that does nothing when inserted
    // is worse than an absent one.
    expect(getPlugin('fx', 'broken')).toBeUndefined();
  });

  // The id-collision case: assertFxFactories must ask "did THIS plugin's own
  // main.js register it", not "does an fx with this id exist ANYWHERE" — a
  // built-in insert (or an earlier, unrelated plugin) already sitting at the
  // same id must not let an impostor that delivers nothing sail through.
  it('a plugin declaring an fx id that already exists elsewhere still fails if it delivers no factory', async () => {
    // Stands in for a built-in insert, or an earlier plugin that DID deliver
    // — either way, something legitimate already occupies 'delay'.
    registerPlugin({
      kind: 'fx',
      manifest: { id: 'delay', name: 'Existing Delay', kind: 'fx', version: '1.0.0', params: [], presets: [] },
      create: () => ({} as unknown as FxInstance),
    });
    const manifest = {
      id: 'imposter', name: 'Imposter', version: '1.0.0', loomApi: 1, main: 'main.js',
      components: [{ kind: 'fx', id: 'delay', name: 'Fake Delay', params: [], fx: { color: '#0f0' } }],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: (async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('index.json') ? { plugins: ['imposter'] } : manifest),
      })) as unknown as typeof fetch,
      importImpl: async () => undefined,   // main.js runs and registers nothing
    });
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].error).toMatch(/declared fx component/);
    // The pre-existing 'delay' is untouched — this plugin never got near it.
    expect(getPlugin('fx', 'delay')?.manifest.name).toBe('Existing Delay');
  });

  // A plugin can deliver one fx and then fail on a LATER component in its
  // OWN manifest. plugin-host.ts's own header promises "nothing it
  // registered may outlive the failure" — that has to hold for an fx that
  // was already fully registered by the time the failure happens, not just
  // for one still parked.
  it('an fx this plugin already delivered is rolled back when a LATER component of the same manifest fails', async () => {
    const manifest = {
      id: 'twoFx', name: 'Two Fx', version: '1.0.0', loomApi: 1, main: 'main.js',
      components: [
        { kind: 'fx', id: 'wah', name: 'Auto-Wah', params: [], fx: { color: '#abc' } },
        { kind: 'fx', id: 'broken2', name: 'Broken2', params: [], fx: { color: '#f00' } },
      ],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: (async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('index.json') ? { plugins: ['twoFx'] } : manifest),
      })) as unknown as typeof fetch,
      // Registers ONLY the first fx — 'broken2' never arrives, so
      // assertFxFactories fails the whole plugin after 'wah' is already live.
      importImpl: async () => {
        (globalThis as unknown as { Loom: { registerFx(id: string, c: unknown): void } }).Loom
          .registerFx('wah', () => ({ input: {}, output: {} } as unknown as FxInstance));
      },
    });
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].error).toMatch(/declared fx component/);
    // The whole point: 'wah' was genuinely registered (factory and all)
    // before the plugin failed. It must not survive being reported as failed.
    expect(getPlugin('fx', 'wah')).toBeUndefined();
  });
});
