// Discovery and main-thread loading of plugins.
//
// The browser cannot list a directory, so `plugins/index.json` IS the discovery
// mechanism. Each plugin is validated as DATA before a single line of it runs,
// and a plugin that throws — even one whose components were already adopted
// before its own main.js blew up — is fully rolled back, recorded and skipped:
// nothing it registered may outlive the failure. One bad plugin must never
// take the app down with it, and must never leave a half-registered engine
// (visible in the selector, silent at note time) behind either.
import { validatePluginManifest } from './manifest-validate';
import { installMainThreadLoomApi, adoptComponents, assertFxFactories } from './loom-api';
import { importPluginModule } from './module-loader';
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
  // NOT a bare `import(url)`: a plugin lives in public/, and the Vite dev server
  // refuses to serve such a file as a module. importPluginModule fetches the
  // source and evaluates it through a blob: URL, which works identically in dev and
  // in the build. See module-loader.ts.
  const doImport = opts.importImpl ?? ((url: string) => importPluginModule(url, doFetch));

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
    // Set only once adoptComponents (below) has actually registered
    // something for this plugin. undoAdoption?.() in the catch is then a
    // real rollback if a later step fails, or a safe no-op if adoption
    // itself never ran (an earlier fetch/validate/presets step threw first,
    // so there is nothing to undo).
    let undoAdoption: (() => void) | undefined;
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

      // Components come from the file we just validated, and MUST be adopted
      // before the import below: an FX plugin's main.js registers its
      // factory by calling Loom.registerFx(id, create) DURING the import, and
      // that call looks up the description parked here by id. Adoption
      // cannot move after the import without breaking that.
      // What CAN move is the consequence of a later failure: if the import
      // throws, undoAdoption() reverses exactly what was just registered, so
      // a plugin that fails never half-installs — an engine that shows up in
      // the lane selector with no DSP behind it, because the throw happened
      // after the descriptor was adopted but the worklet never got wired.
      undoAdoption = adoptComponents(manifest.components, manifest.version);

      if (manifest.main) await doImport(`${dir}${manifest.main}`);
      // Every fx this manifest declared must have registered a factory by
      // now — Loom.registerFx runs synchronously during the import above. A
      // plugin that promised an insert and delivered nothing fails here,
      // instead of loading as a picker entry that does nothing when inserted.
      assertFxFactories(manifest);
      if (manifest.dsp) report.dspUrls.push(`${dir}${manifest.dsp}`);
      report.loaded.push(id);
    } catch (e) {
      undoAdoption?.();
      report.failed.push({ id, error: errText(e) });
      console.warn(`[plugin-host] "${id}" failed to load:`, e);
    }
  }
  return report;
}
