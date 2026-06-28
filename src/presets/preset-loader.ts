import type { EnginePreset } from '../engines/engine-types';

export function validatePresetEntry(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return false;
  if (!Array.isArray(r.gm)) return false;
  for (const v of r.gm) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= 128) return false;
  }
  if (typeof r.params !== 'object' || r.params === null) return false;
  return true;
}

interface PresetFile {
  engineId: string;
  presets: unknown[];
}

const cache = new Map<string, EnginePreset[]>();
let ready = false;

export async function loadEnginePresets(engineId: string): Promise<EnginePreset[]> {
  if (cache.has(engineId)) return cache.get(engineId)!;
  // Prefix with Vite's BASE_URL so the fetch resolves under the deploy sub-path
  // (e.g. GitHub Pages `/Loom/`). BASE_URL ends in `/`, and is `/` in dev and
  // the standard build, so the resolved path is unchanged there.
  const url = `${import.meta.env.BASE_URL}presets/${engineId}.json`;
  const res = await fetch(url);
  // A missing presets/<id>.json is expected for engines that don't keep their
  // presets in the param-preset files: `audio` has no presets at all, and
  // `sampler` carries its own elsewhere (bundled instruments via
  // instruments/index.json + drum kits via drum-kits.json) — not param presets
  // here. The "absent" signal differs by environment:
  //   - production / preview: a real 404 (`!res.ok`);
  //   - Vite dev server: the SPA fallback serves index.html with a 200 and a
  //     text/html content-type (so `res.json()` would choke on `<!DOCTYPE`).
  // Treat both as "no param-preset file for this engine" → empty, no noise. Only
  // a file that IS served as JSON but parses badly is a real error to surface.
  const contentType = res.headers?.get('content-type') ?? '';
  if (!res.ok || !contentType.includes('json')) {
    cache.set(engineId, []);
    return [];
  }
  const body = (await res.json()) as PresetFile;
  const seen = new Set<string>();
  const out: EnginePreset[] = [];
  for (const raw of body.presets ?? []) {
    if (!validatePresetEntry(raw)) {
      console.warn(`[preset-loader] dropping malformed preset in ${engineId}.json`, raw);
      continue;
    }
    const entry = raw as EnginePreset;
    if (seen.has(entry.name)) {
      console.warn(`[preset-loader] duplicate preset name "${entry.name}" in ${engineId}.json — dropping`);
      continue;
    }
    seen.add(entry.name);
    out.push(entry);
  }
  cache.set(engineId, out);
  return out;
}

export async function loadAllPresets(engineIds: string[]): Promise<void> {
  await Promise.all(engineIds.map(async (id) => {
    try { await loadEnginePresets(id); }
    catch (err) { console.warn(`[preset-loader] failed to load ${id}:`, err); }
  }));
  ready = true;
}

export function isPresetsReady(): boolean { return ready; }

export function getCachedPresets(engineId: string): EnginePreset[] {
  return cache.get(engineId) ?? [];
}

/** Test-only — reset module state between cases. */
export function __resetPresetCache(): void {
  cache.clear();
  ready = false;
}

/** Test-only — seed the cache directly so engine.presets (which reads
 *  getCachedPresets) is non-empty without a fetch. Pair with
 *  beforeEach(__resetPresetCache) to stay isolated from other test files. */
export function __seedPresetCache(engineId: string, presets: EnginePreset[]): void {
  cache.set(engineId, presets);
}
