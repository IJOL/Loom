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
  // Sampler presets carry an optional `zones` keymap (wav URL + note range per
  // zone). When present it must be a well-formed array; synth presets omit it.
  if (r.zones !== undefined && !validateZones(r.zones)) return false;
  return true;
}

/** Validate a Sampler preset's `zones`: an array of { url, rootNote, loNote,
 *  hiNote, gain? } with notes in [0,127] and a non-empty url. */
function validateZones(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  for (const z of raw) {
    if (typeof z !== 'object' || z === null) return false;
    const zz = z as Record<string, unknown>;
    if (typeof zz.url !== 'string' || zz.url.length === 0) return false;
    for (const k of ['rootNote', 'loNote', 'hiNote'] as const) {
      const v = zz[k];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 127) return false;
    }
    if (zz.gain !== undefined && typeof zz.gain !== 'number') return false;
  }
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
  // A missing presets/<id>.json is expected for engines with no preset file —
  // e.g. `audio` (a plain audio channel has no presets). The "absent" signal
  // differs by environment:
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
