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
import type { LayerSpec } from '../audio-dsp/layers/layer-spec';

/** Engine id → name → param bag. One key holds them all. */
export const USER_PRESETS_KEY = 'loom-user-presets-v1';

/** A saved sound: param id → base value, in the vocabulary of one engine. */
export type UserPresetParams = Record<string, number>;

/** What "Save As…" keeps.
 *
 *  The params alone were enough while every engine was one instrument. A LAYERS
 *  lane is not: its declared params are the four slots' knobs, prefixed
 *  `l0.`…`l3.`, and WHICH instrument sits in each slot is the rack — structural,
 *  not a param, and so absent from the snapshot.
 *
 *  Saving the knobs without the rack is worse than not saving at all: recall it
 *  onto a rack built differently and slot 0's cutoff lands on whatever engine is
 *  in slot 0 now. Values that mean nothing, applied in silence. So a preset for
 *  a layered lane carries its rack, and recalling one rebuilds it. */
export interface UserPreset {
  params: UserPresetParams;
  /** The rack, for a lane that has one. Absent on every ordinary engine. */
  layers?: LayerSpec[];
}

/** Read a stored entry in either shape.
 *
 *  Everything written before this existed is a bare param bag. Accepting both is
 *  three lines and keeps every preset anyone has already saved — the alternative
 *  is a migration, and a migration for a format nobody has strong feelings about
 *  is more code and more risk than a `typeof` check. */
function asPreset(raw: unknown): UserPreset {
  if (raw && typeof raw === 'object' && 'params' in (raw as object)) return raw as UserPreset;
  return { params: (raw ?? {}) as UserPresetParams };
}

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

type PresetsByEngine = Record<string, Record<string, unknown>>;

/** The store, or nothing at all.
 *
 *  `localStorage` is not a given any more. This used to be read only from a
 *  dropdown — there was always a browser — and it is now also read by the preset
 *  catalogue, which answers "what can this lane play" from anywhere, including a
 *  headless test and an offline render. Absent storage is the same case the
 *  `catch` below already covers: there is nothing saved, which is a legitimate
 *  answer and not a failure. */
const store = (): Storage | null =>
  (typeof localStorage === 'undefined' ? null : localStorage);

function readAll(): PresetsByEngine {
  const raw = store()?.getItem(USER_PRESETS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PresetsByEngine) : {};
  } catch { return {}; }
}

function writeAll(all: PresetsByEngine): void {
  // Nowhere to write is not an error either — it is a session that cannot
  // persist, and saying so by throwing would take the sound down with it.
  store()?.setItem(USER_PRESETS_KEY, JSON.stringify(all));
}

/** Every user preset available to `engineId`. */
export function loadUserPresets(engineId: string): Record<string, UserPreset> {
  const forEngine = readAll()[engineId] ?? {};
  const out: Record<string, UserPreset> = {};
  for (const [name, raw] of Object.entries(forEngine)) out[name] = asPreset(raw);
  return out;
}

export function saveUserPreset(engineId: string, name: string, preset: UserPreset): void {
  const all = readAll();
  all[engineId] = { ...(all[engineId] ?? {}), [name]: preset };
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
