// User presets, filed under the engine they belong to.
//
// A preset is a bag of the ids ONE engine declares. That sounds obvious and was
// not the case: "Save As…" used to snapshot the twenty-three subtractive dot-ids
// off whatever engine the active lane ran, so saving on an FM lane stored ids FM
// has never heard of — and filed them where every subtractive lane would offer
// them. The engine id is what stops that, and it is why this store is keyed by
// engine rather than by name alone.
//
// TWO KEYS, ON PURPOSE. There are no migrations in this project, so the presets
// a user saved before this existed are read where they lie, in the old key, in
// the old nested shape, and are never rewritten. Only subtractive ever wrote
// there, so only subtractive reads it.

import { isStripParamId } from '../core/channel-strip-params';
import type { EngineParamSpec } from '../engines/engine-params';
import { flatToPolyParams, polyParamsToFlat } from './poly-preset-store';
import type { PolySynthParams } from './poly-params';

/** Where presets saved from now on live: engine id → name → param bag. */
export const USER_PRESETS_KEY = 'loom-user-presets-v1';

/** Where subtractive presets saved before this store live. Read-only, forever:
 *  the nested `PolySynthParams` shape under it IS those presets, and rewriting
 *  it would lose every one the user has. */
export const LEGACY_POLY_PRESETS_KEY = 'tb303-poly-presets-v1';

/** A saved sound: param id → base value, in the vocabulary of one engine. */
export type UserPresetParams = Record<string, number>;

/** The half of a SynthEngine a snapshot needs. Narrow on purpose — it makes the
 *  snapshot testable without building an engine. */
export interface SnapshotSource {
  readonly params: readonly EngineParamSpec[];
  getBaseValue(id: string): number;
}

/** Read every param the engine DECLARES, which is the only set that means
 *  anything to it.
 *
 *  The strip params are excluded although every engine spreads them into its
 *  own list: level, pan, sends and EQ are the desk, not the patch. Recalling a
 *  preset must not move the fader. */
export function snapshotEngineParams(engine: SnapshotSource): UserPresetParams {
  const out: UserPresetParams = {};
  for (const spec of engine.params) {
    if (isStripParamId(spec.id)) continue;
    out[spec.id] = engine.getBaseValue(spec.id);
  }
  return out;
}

type PresetsByEngine = Record<string, Record<string, UserPresetParams>>;

function readAll(): PresetsByEngine {
  const raw = localStorage.getItem(USER_PRESETS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PresetsByEngine) : {};
  } catch { return {}; }
}

function writeAll(all: PresetsByEngine): void {
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(all));
}

/** The legacy subtractive presets, flattened into the dot-ids the engine reads.
 *  Never written back. */
function readLegacySubtractive(): Record<string, UserPresetParams> {
  const raw = localStorage.getItem(LEGACY_POLY_PRESETS_KEY);
  if (!raw) return {};
  let parsed: Record<string, PolySynthParams>;
  try { parsed = JSON.parse(raw) as Record<string, PolySynthParams>; } catch { return {}; }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, UserPresetParams> = {};
  for (const [name, nested] of Object.entries(parsed)) {
    // Round-trip through flatToPolyParams so a partial old entry still lands on
    // the full shape before being flattened.
    try { out[name] = polyParamsToFlat(flatToPolyParams(polyParamsToFlat(nested))); }
    catch { /* an entry we cannot read is one we skip, not a crash */ }
  }
  return out;
}

/** Every user preset available to `engineId`. Subtractive also sees the ones
 *  saved before this store; a newer preset of the same name wins. */
export function loadUserPresets(engineId: string): Record<string, UserPresetParams> {
  const legacy = engineId === 'subtractive' ? readLegacySubtractive() : {};
  return { ...legacy, ...(readAll()[engineId] ?? {}) };
}

export function saveUserPreset(engineId: string, name: string, params: UserPresetParams): void {
  const all = readAll();
  all[engineId] = { ...(all[engineId] ?? {}), [name]: params };
  writeAll(all);
}

/** Forget a preset. A legacy subtractive one cannot be deleted — it lives in a
 *  key this store does not write — so deleting a name that only exists there is
 *  a no-op, and the caller is told so. */
export function deleteUserPreset(engineId: string, name: string): boolean {
  const all = readAll();
  const forEngine = all[engineId];
  if (!forEngine || !(name in forEngine)) return false;
  delete forEngine[name];
  if (Object.keys(forEngine).length === 0) delete all[engineId];
  writeAll(all);
  return true;
}
