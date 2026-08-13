// WHAT A LANE CAN PLAY — one answer, for every surface that asks.
//
// Three places used to answer this, each in its own way: the instrument page's
// dropdown, the drums page's kit picker, and the WEAVE panel. They disagreed,
// and not by accident — WEAVE offered a sampler lane a third of what the
// instrument page did, because the ids for the rest were understood by exactly
// one file and it was not this one.
//
// This is the same rule the automation destinations already live under: anything
// that LISTS what the user can choose calls the one catalogue and never builds a
// parallel list. A second list is not a shortcut, it is a promise to keep two
// things in step for ever, and this codebase has already lost that bet twice.
//
// It answers by ENGINE, not by lane: what a lane may play is a property of the
// instrument in it. Which one it is currently ON is a different question with a
// different owner, and deliberately not here.
//
// AND IT ANSWERS FOR A LANE, NEVER FOR A RACK SLOT. The two sound like one
// question and are not: a lane may be a Sampler, and a slot may not — the
// Sampler runs in a processor of its own, so `LayersRenderer` skips a slot
// holding one and that end of the control is silence while its dropdown names
// an instrument. `slotChoices` (engines/layers-rack-ui.ts) is the narrower
// answer, filtered by `isWorkletHosted`, and it exists because that exact
// failure shipped.
//
// So do NOT route the slot picker through here on the grounds that it looks
// like one more duplicated list. It is the one list that must stay separate,
// and the reason is not taste — it is which thread can build the thing.

import { getCachedPresets } from '../presets/preset-loader';
import { getDrumKits, loadDrumKits } from '../presets/drum-kits-loader';
import { getInstrumentIndex, loadInstrumentIndex } from '../samples/instrument-loader';
import { getFactoryPolyPresets } from './poly-preset-store';
import { loadUserPresets } from './user-preset-store';
import { usesKitPresets } from '../plugins/capabilities';
import { setLaneRack } from '../engines/layers-rack-ui';
import { presetControlsDeps } from './preset-select-state';
import { applyEnginePresetToLane, applyUserPresetToLane } from './poly-preset-apply';

export interface PresetChoice {
  /** The id the apply door understands, prefix and all. */
  id: string;
  name: string;
  /** The optgroup this belongs under. */
  group: string;
}

/** By NAME, case- and accent-insensitively, numbers as numbers so "Pad 2"
 *  precedes "Pad 10". */
const byName = (a: PresetChoice, b: PresetChoice): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Everything the engine in this lane can be put on, grouped and sorted.
 *
 *  SYNCHRONOUS, because every caller is a dropdown that has to render now. Two
 *  of the shelves live behind an index that loads once; while it is loading this
 *  returns what it has and calls `onReady` when there is more — the same
 *  two-phase fill the pickers were each doing for themselves.
 *
 *  An unknown engine gets an empty list rather than a guess: a picker with
 *  nothing in it is honest, and one full of another engine's presets is not. */
export function presetsFor(engineId: string, onReady?: () => void): PresetChoice[] {
  // A KIT engine reads the unified Synth/Samples catalogue — the same list the
  // Drums page shows, which is the whole reason the Sampler no longer offers it.
  if (usesKitPresets(engineId)) {
    const kits = getDrumKits();
    if (kits.length === 0 && onReady) void loadDrumKits().then(onReady);
    return kits.map((k) => ({ id: `engine:${k.name}`, name: k.name, group: k.group }));
  }

  if (engineId === 'sampler') return samplerShelf(onReady);

  // Every other engine: what it ships, and what you saved on it.
  //
  // Subtractive is the one whose factory list is not on the instance — its
  // presets are stored flat and expanded through the nested shape its old user
  // presets share. Both roads end in `engine:<name>` and both apply the same.
  const factory = engineId === 'subtractive'
    ? getFactoryPolyPresets().map((p) => p.name)
    : getCachedPresets(engineId).map((p) => p.name);

  // Per ENGINE, not global: a preset saved on an FM lane is FM's vocabulary and
  // means nothing to Subtractive.
  const user = Object.keys(loadUserPresets(engineId));

  return [
    ...factory.map((name) => ({ id: `engine:${name}`, name, group: 'Factory' })),
    ...user.sort().map((name) => ({ id: `user:${name}`, name, group: 'User' })),
  ];
}

/** The sampler's two shelves.
 *
 *  MELODIC merges the two sources that are the same idea — `presets/sampler.json`
 *  carries its zones inline, `instruments/index.json` is fetched by id — because
 *  which file a pitched multi-zone instrument lives in is our storage layout and
 *  not something a player should have to know.
 *
 *  LOOPS stays apart because it is genuinely other material: a chopped amen is
 *  not an instrument you play up the keyboard. */
function samplerShelf(onReady?: () => void): PresetChoice[] {
  const inline: PresetChoice[] = getCachedPresets('sampler')
    .map((p) => ({ id: `sampler:preset:${p.name}`, name: p.name, group: 'Melodic' }));

  const index = getInstrumentIndex();
  if (index.length === 0 && onReady) void loadInstrumentIndex().then(onReady);

  const ofFamily = (family: string, group: string): PresetChoice[] =>
    index.filter((i) => i.family === family)
      .map((i) => ({ id: `sampler:${family}:${i.id}`, name: i.name, group }));

  return [
    ...[...inline, ...ofFamily('melodic', 'Melodic')].sort(byName),
    ...ofFamily('loop', 'Loops').sort(byName),
  ];
}

/** Put this lane on that preset. The other half of the door.
 *
 *  It has to live beside the LIST, and not because it is tidy: `engine:<name>`
 *  means two different things depending on the engine. On a kit engine it names
 *  a drum kit, which is applied by REBUILDING the lane's editor; everywhere else
 *  it names a factory preset, which is applied by pushing values. A caller
 *  holding only the list would have to know that, and the one that did not know
 *  it shipped a dropdown that changed and did nothing else.
 *
 *  Returns false when nothing was applied — an unknown prefix, a user preset
 *  that has since been deleted — so a caller can leave its selection alone
 *  rather than claim a sound it did not get.
 *
 *  It does NOT record what was picked. That is the third question, it has three
 *  answers already, and giving it a fourth here is how this file would become
 *  the problem it was written to fix. */
export function applyPresetToLane(laneId: string, id: string): boolean {
  const deps = presetControlsDeps();
  if (!deps || !id || id === '__custom__') return false;

  // A bundled instrument ref — the sampler's own vocabulary. Loaded through the
  // engine, which fetches, decodes, builds the keymap and mirrors the id.
  if (id.startsWith('sampler:')) {
    const instance = deps.getLaneEngineInstance(laneId) as unknown as
      { loadFamilyRef?: (r: string) => Promise<void> } | null;
    if (!instance?.loadFamilyRef) return false;
    void instance.loadFamilyRef(id.slice('sampler:'.length));
    return true;
  }

  if (id.startsWith('engine:')) {
    const name = id.slice('engine:'.length);
    // The kit road. Applying one rebuilds the lane's editor rather than pushing
    // params, and the params road would simply not find a kit's name.
    if (usesKitPresets(deps.getLaneEngineId(laneId))) {
      const apply = (deps as { applyDrumKitPreset?: (l: string, n: string) => void }).applyDrumKitPreset;
      if (!apply) return false;
      apply(laneId, name);
      return true;
    }
    // A factory preset goes through engine.applyPreset — the SAME path the
    // session loader uses. Each engine owns the mapping from its preset JSON
    // keys to its internal state, and those keys are not always setBaseValue
    // ids, so a generic loop here would silently no-op on some engines.
    applyEnginePresetToLane(deps, laneId, name);
    return true;
  }

  if (id.startsWith('user:')) {
    // A bag of THIS engine's setBaseValue ids, looked up under that engine — so
    // the same name on two engines is two different sounds.
    const saved = loadUserPresets(deps.getLaneEngineId(laneId))[id.slice('user:'.length)];
    if (!saved) return false;

    // The RACK first, when the preset carries one. It is the instrument the
    // params are written in: restoring the knobs onto a differently-built rack
    // puts slot 0's cutoff on whatever engine is in slot 0 now.
    //
    // Writing a rack REBUILDS the lane, so the params go on afterwards — the
    // rebuilt engine takes each of them from its spec default until something
    // says otherwise.
    if (saved.layers?.length) {
      const lane = deps.getSessionState()?.lanes.find((l) => l.id === laneId);
      setLaneRack(lane, saved.layers);
    }
    applyUserPresetToLane(deps, laneId, saved.params);
    return true;
  }

  return false;
}

/** The groups in the order they should be drawn, with their items.
 *
 *  Derived from the list rather than declared beside it: a second list of group
 *  names is one more thing to forget when a shelf is added. First appearance
 *  wins, which is why `presetsFor` returns them already in the order it wants
 *  them read. */
export function presetGroupsFor(engineId: string, onReady?: () => void): [string, PresetChoice[]][] {
  const out = new Map<string, PresetChoice[]>();
  for (const c of presetsFor(engineId, onReady)) {
    const at = out.get(c.group);
    if (at) at.push(c); else out.set(c.group, [c]);
  }
  return [...out];
}
