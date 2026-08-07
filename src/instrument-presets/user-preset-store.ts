// User presets, filed under the engine they belong to.
//
// A preset is a bag of the ids ONE engine declares. That sounds obvious and was
// not the case: "Save As…" used to snapshot the twenty-three subtractive dot-ids
// off whatever engine the active lane ran, so saving on an FM lane stored ids FM
// has never heard of — and filed them where every subtractive lane would offer
// them. The engine id is what stops that, and it is why this store is keyed by
// engine rather than by name alone.

import { isStripParamId } from '../core/channel-strip-params';
import type { EngineParamSpec } from '../engines/engine-params';

/** Engine id → name → param bag. One key holds them all. */
export const USER_PRESETS_KEY = 'loom-user-presets-v1';

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

/** Every user preset available to `engineId`. */
export function loadUserPresets(engineId: string): Record<string, UserPresetParams> {
  return readAll()[engineId] ?? {};
}

export function saveUserPreset(engineId: string, name: string, params: UserPresetParams): void {
  const all = readAll();
  all[engineId] = { ...(all[engineId] ?? {}), [name]: params };
  writeAll(all);
}

/** Forget a preset. Returns false when there was nothing by that name. */
export function deleteUserPreset(engineId: string, name: string): boolean {
  const all = readAll();
  const forEngine = all[engineId];
  if (!forEngine || !(name in forEngine)) return false;
  delete forEngine[name];
  if (Object.keys(forEngine).length === 0) delete all[engineId];
  writeAll(all);
  return true;
}
