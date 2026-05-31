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
  const res = await fetch(`/presets/${engineId}.json`);
  if (!res.ok) throw new Error(`Failed to load /presets/${engineId}.json: ${res.status}`);
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

/** Test-only — seed the cache directly so engine.presets is non-empty without
 *  a fetch round-trip. Mirrors what loadEnginePresets caches at runtime. */
export function __seedPresetCache(engineId: string, presets: EnginePreset[]): void {
  cache.set(engineId, presets);
}
