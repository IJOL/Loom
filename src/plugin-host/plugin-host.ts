// Discovery and main-thread loading of plugins.
//
// The browser cannot list a directory, so `plugins/index.json` IS the discovery
// mechanism. Each plugin is validated as DATA before a single line of it runs,
// and a plugin that throws is recorded and skipped — one bad plugin must never
// take the app down with it.
import { validatePluginManifest } from './manifest-validate';
import { installMainThreadLoomApi } from './loom-api';
import { seedEnginePresets, validatePresetEntry } from '../presets/preset-loader';
import type { EnginePreset } from '../engines/engine-types';

export interface PluginLoadReport {
  loaded: string[];
  failed: { id: string; error: string }[];
  /** Absolute-ish URLs of every `dsp.js`, in load order. Handed to the worklet
   *  loader and to the offline path. */
  dspUrls: string[];
}

export interface LoadPluginsOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  importImpl?: (url: string) => Promise<unknown>;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadPlugins(opts: LoadPluginsOptions = {}): Promise<PluginLoadReport> {
  const base = opts.baseUrl ?? import.meta.env.BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const doImport = opts.importImpl ?? ((url: string) => import(/* @vite-ignore */ url));

  installMainThreadLoomApi();

  const report: PluginLoadReport = { loaded: [], failed: [], dspUrls: [] };

  let ids: string[] = [];
  try {
    const res = await doFetch(`${base}plugins/index.json`);
    if (res.ok) {
      const body = (await res.json()) as { plugins?: unknown };
      if (Array.isArray(body.plugins)) ids = body.plugins.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // No index at all: a build with no plugins. Not an error.
    return report;
  }

  for (const id of ids) {
    const dir = `${base}plugins/${id}/`;
    try {
      const res = await doFetch(`${dir}plugin.json`);
      if (!res.ok) throw new Error(`plugin.json returned ${res.status}`);
      const verdict = validatePluginManifest(await res.json());
      if (!verdict.ok) throw new Error(verdict.error);
      const manifest = verdict.manifest;

      // Presets first: a plugin's engine reads getCachedPresets(id) the moment
      // its descriptor is built, so the cache must already hold them.
      if (manifest.presets) {
        try {
          const pres = await doFetch(`${dir}${manifest.presets}`);
          if (pres.ok) {
            const body = (await pres.json()) as { presets?: unknown[] };
            const clean = (body.presets ?? []).filter(validatePresetEntry) as EnginePreset[];
            seedEnginePresets(manifest.id, clean);
          }
        } catch { /* a plugin with no usable presets still loads */ }
      }

      await doImport(`${dir}${manifest.main}`);
      if (manifest.dsp) report.dspUrls.push(`${dir}${manifest.dsp}`);
      report.loaded.push(id);
    } catch (e) {
      report.failed.push({ id, error: errText(e) });
      console.warn(`[plugin-host] "${id}" failed to load:`, e);
    }
  }
  return report;
}
