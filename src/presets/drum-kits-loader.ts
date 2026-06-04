// src/presets/drum-kits-loader.ts
// Loads + validates the curated unified drum-kit preset list
// (public/presets/drum-kits.json) that drives the Drums-page picker. Each entry
// is either a synth kit (kitId → DrumMachine) or a sample kit (drumkitId →
// embedded sampler). Kept in its OWN cache, separate from the EnginePreset cache
// (its schema has no gm[]/params{} and would fail validatePresetEntry).

export interface DrumKitPreset {
  name: string;
  group: string;            // display heading, e.g. 'Synth' | 'Samples'
  kind: 'synth' | 'sample';
  kitId?: string;           // synth: a DrumMachine KIT id
  drumkitId?: string;       // sample: a bundled drumkit id (public/drumkits/<id>.json)
}

export function validateDrumKit(raw: unknown): raw is DrumKitPreset {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return false;
  if (typeof r.group !== 'string' || r.group.length === 0) return false;
  if (r.kind === 'synth') return typeof r.kitId === 'string' && r.kitId.length > 0;
  if (r.kind === 'sample') return typeof r.drumkitId === 'string' && r.drumkitId.length > 0;
  return false;
}

let cache: DrumKitPreset[] | null = null;
let inflight: Promise<DrumKitPreset[]> | null = null;

/** Fetch + validate once; idempotent (returns the cached promise on re-call). */
export function loadDrumKits(fetchFn: typeof fetch = fetch): Promise<DrumKitPreset[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Base-aware so the fetch resolves under the deploy sub-path (e.g. GitHub
      // Pages `/Loom/`); BASE_URL is `/` in dev + the standard build.
      const res = await fetchFn(`${import.meta.env.BASE_URL}presets/drum-kits.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { presets?: unknown[] };
      const seen = new Set<string>();
      const out: DrumKitPreset[] = [];
      for (const raw of body.presets ?? []) {
        if (!validateDrumKit(raw)) { console.warn('[drum-kits] dropping malformed entry', raw); continue; }
        if (seen.has(raw.name)) { console.warn(`[drum-kits] duplicate name "${raw.name}" — dropping`); continue; }
        seen.add(raw.name);
        out.push(raw);
      }
      cache = out;
      return out;
    } catch (err) {
      console.warn('[drum-kits] failed to load drum-kits.json:', err);
      cache = [];
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous cache read — empty until loadDrumKits resolves. */
export function getDrumKits(): DrumKitPreset[] {
  return cache ?? [];
}

/** Look up one unified entry by display name. */
export function findDrumKit(name: string): DrumKitPreset | undefined {
  return getDrumKits().find((p) => p.name === name);
}

/** Test-only — reset module state between cases. */
export function __resetDrumKitsCache(): void {
  cache = null;
  inflight = null;
}
