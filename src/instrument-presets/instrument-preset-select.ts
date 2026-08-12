// The instrument page's preset dropdown, #instrument-preset-select, and the
// three buttons beside it. ONE select serves every non-drum lane — the six
// melodic engines, the sampler and the audio channel — which is why nothing
// here is named after an engine.
//
// It used to live in `polysynth-presets.ts`, next to the Subtractive user-preset
// storage, in a directory named after a class deleted with the worklet cutover.
// Two unrelated things under one misleading name is how "Save As…" came to
// snapshot subtractive's ids off every engine.

import { html } from 'lit-html';
import { renderInto } from '../core/lit-fill';
import { customOption, presetGroup } from './poly-preset-templates';
import { presetGroupsFor } from './preset-catalogue';
import { alertDialog, confirmDialog, promptDialog } from '../core/dialog';
import { applyEnginePresetToLane, applyUserPresetToLane } from './poly-preset-apply';
import {
  snapshotEngineParams, loadUserPresets, saveUserPreset, deleteUserPreset,
} from './user-preset-store';
import { getInstrumentIndex } from '../samples/instrument-loader';
import { withUndo } from '../save/history-wiring';
import {
  pagePresetName, presetControlsDeps, setPresetControlsDeps, type PresetControlsDeps,
} from './preset-select-state';

const SELECT_ID = 'instrument-preset-select';

const selectEl = (): HTMLSelectElement | null =>
  document.getElementById(SELECT_ID) as HTMLSelectElement | null;

// Bumped on every population so a slow async fill (the sampler's instrument
// list) bails if the user has since switched lanes.
let popGen = 0;

/** What a SAMPLER lane is playing, in the dropdown's vocabulary.
 *
 *  `pagePresetName` only remembers what someone PICKED, so a lane that arrived
 *  from a session or demo came up "(custom — no preset)" while holding a
 *  perfectly nameable instrument. The lane itself already says which one — that
 *  is the single source of truth, and copying it into a second `enginePresetName`
 *  string would only give the load path a redundant async instrument fetch to
 *  race with. So the selection is DERIVED from the lane when nobody has picked
 *  anything.
 *
 *  The three sampler sub-ids are mutually exclusive (see session-types); this
 *  reads them in the load path's own precedence. An `instrumentId` may be either
 *  family, so `family` disambiguates once the index has loaded — before that it
 *  guesses melodic, which the async fill corrects. */
function samplerSelectionFor(laneId: string, family?: (id: string) => string | undefined): string | undefined {
  const picked = pagePresetName.get(laneId);
  if (picked) return picked;
  const s = presetControlsDeps()?.getSessionState()?.lanes
    .find((l) => l.id === laneId)?.engineState?.sampler;
  if (!s) return undefined;
  if (s.drumkitId) return `sampler:drumkit:${s.drumkitId}`;
  if (s.instrumentId) return `sampler:${family?.(s.instrumentId) ?? 'melodic'}:${s.instrumentId}`;
  if (s.presetName) return `sampler:preset:${s.presetName}`;
  return undefined;
}

/** Point the dropdown at whatever the active lane has selected. */
export function refreshInstrumentPresetSelect(): void {
  const sel = selectEl();
  if (!sel) return;
  const deps = presetControlsDeps();
  const laneId = deps?.getActiveEngineLaneId();
  if (!laneId) { sel.value = '__custom__'; return; }
  const fromLane = deps?.getLaneEngineId(laneId) === 'sampler' ? samplerSelectionFor(laneId) : undefined;
  sel.value = fromLane ?? pagePresetName.get(laneId) ?? '__custom__';
}

/** Populate the dropdown for an explicit lane.
 *
 *  Exposed separately from `populateInstrumentPresetSelect` so the lane editor
 *  can call it for a lane it is about to show, without depending on
 *  getActiveEngineLaneId() having been updated yet. */
export function populateInstrumentPresetSelectForLane(laneId: string): void {
  const sel = selectEl();
  if (!sel) return;
  const gen = ++popGen;

  const deps = presetControlsDeps();
  if (!deps) {
    renderInto(sel, html`${customOption()}`);
    return;
  }
  const engineId = deps.getLaneEngineId(laneId);

  // TWO groups, and the reason is what the sampler can BE rather than where a
  // file happens to live.
  //
  // `presets/sampler.json` and the `melodic` family of `instruments/index.json`
  // are the same idea twice — a pitched multi-zone instrument — differing only
  // in whether the zones travel inline or are fetched by id. Offering them as
  // "Presets" and "Instrument" showed the user our storage layout and asked
  // them to care. Merged and sorted, they are one shelf: **Melodic**.
  //
  // **Loops** stays its own group because it is genuinely other material: a
  // chopped amen is not an instrument you play up the keyboard.
  //
  // **Drumkits are GONE from here.** They are the drum machine's shelf and the
  // Drums page already serves all of them; a sampler lane could still be put on
  // one, which meant the same kit appeared in two engines' pickers and the
  // longest list in this dropdown was the one that belonged to another page. A
  // session already holding one still loads and plays — only the picker stops
  // offering it, and `picker`'s off-shelf label keeps it visible rather than
  // reading as nothing chosen.
  // WHAT to offer is not this file's question any more — `presetGroupsFor` is
  // the one catalogue, and WEAVE reads the same one, so the two cannot drift.
  // What is left here is drawing it and remembering which one is selected.
  //
  // The refill is what the async shelves need: two of them live behind an index
  // that loads once, so the first render shows what is known and this puts the
  // rest in when it arrives. It bails if the user switched lanes meanwhile.
  const draw = () => {
    const s = selectEl();
    if (!s) return;
    const groups = presetGroupsFor(engineId, () => { if (gen === popGen) draw(); });
    renderInto(s, html`${customOption()}${groups.map(([label, items]) =>
      presetGroup(label, items.map((c) => [c.id, c.name] as [string, string])))}`);
    s.value = currentSelectionFor(laneId, engineId) ?? '__custom__';
  };
  draw();
}

/** Which option this lane's dropdown should be showing.
 *
 *  A sampler lane DERIVES it from the lane when nobody has picked anything this
 *  session; every other engine remembers only what was picked. Both readings
 *  were already here — this only gives them one name. */
function currentSelectionFor(laneId: string, engineId: string): string | undefined {
  if (engineId === 'sampler') {
    const familyOf = (id: string) => getInstrumentIndex().find((i) => i.id === id)?.family;
    return samplerSelectionFor(laneId, familyOf);
  }
  return pagePresetName.get(laneId);
}

export function populateInstrumentPresetSelect(): void {
  const deps = presetControlsDeps();
  if (deps) populateInstrumentPresetSelectForLane(deps.getActiveEngineLaneId());
}

export function wireInstrumentPresetControls(deps: PresetControlsDeps): void {
  setPresetControlsDeps(deps);

  // The "🎲 Sound" dice is NOT wired here. It lives in core/randomize-ui.ts,
  // which owns the one action both dice buttons run. It used to be duplicated
  // here, and this copy was the broken one: it called rebuildEngineParamUI —
  // the engine-swap tool — which unregisters the lane's knobs and only re-mounts
  // them for Subtractive, freezing every other engine's modulation rings.
  //
  // The per-engine branching that USED to sit here is gone for good and must not
  // come back: `subtractive` had a hand-tuned randomizer that rolled a fresh bag
  // from its defaults (discarding the loaded preset), and every other engine fell
  // through to methods no engine implemented, so the click marked the dropdown
  // Custom and changed nothing. engines/engine-randomize.ts biases toward each
  // param's CURRENT value, so it explores AROUND the sound you have.

  populateInstrumentPresetSelect();

  const loadCurrentPreset = () => {
    const sel = selectEl();
    if (!sel) return;
    const val = sel.value;
    if (!val || val === '__custom__') return;
    const laneId = deps.getActiveEngineLaneId();

    // Sampler: a "preset" is a bundled instrument ref ('sampler:drumkit:tr808',
    // …). Load it through the engine (async fetch + decode + keymap + id mirror).
    if (val.startsWith('sampler:')) {
      const ref = val.slice('sampler:'.length);
      const instance = deps.getLaneEngineInstance(laneId) as unknown as { loadFamilyRef?: (r: string) => Promise<void> } | null;
      void instance?.loadFamilyRef?.(ref);
      pagePresetName.set(laneId, val);
      return;
    }

    // A factory preset goes through engine.applyPreset — the SAME path the
    // session loader uses. Each engine owns the mapping from its preset JSON
    // keys to its internal state, and those keys are not always setBaseValue
    // ids, so a generic loop here would silently no-op on some engines.
    if (val.startsWith('engine:')) {
      applyEnginePresetToLane(deps, laneId, val.slice('engine:'.length));
      pagePresetName.set(laneId, val);
      return;
    }

    // A user preset is a bag of THIS engine's setBaseValue ids, looked up under
    // that engine — so the same name on two engines is two different sounds.
    if (val.startsWith('user:')) {
      const name = val.slice('user:'.length);
      const presets = loadUserPresets(deps.getLaneEngineId(laneId));
      if (presets[name]) {
        applyUserPresetToLane(deps, laneId, presets[name]);
        pagePresetName.set(laneId, val);
      }
    }
  };

  const undoable = (fn: () => void) => () => {
    if (deps.historyDeps) withUndo(deps.historyDeps, fn);
    else fn();
  };

  // Selecting a preset applies it immediately; the Load button re-applies the
  // current selection.
  selectEl()?.addEventListener('change', undoable(loadCurrentPreset));
  document.getElementById('instrument-preset-load')
    ?.addEventListener('click', undoable(loadCurrentPreset));

  document.getElementById('instrument-preset-save')?.addEventListener('click', async () => {
    const name = await promptDialog('Preset name:');
    const trimmed = name?.trim();
    if (!trimmed) return;
    // Snapshot the params the lane's engine DECLARES, and file them under that
    // engine. This used to read a hardcoded list of subtractive dot-ids off
    // whatever engine was active, which on an FM lane saved defaults for ids FM
    // does not have — and put them in subtractive's list.
    const laneId = deps.getActiveEngineLaneId();
    const engine = deps.getLaneEngineInstance(laneId);
    if (!engine) return;
    saveUserPreset(deps.getLaneEngineId(laneId), trimmed, snapshotEngineParams(engine));
    populateInstrumentPresetSelect();
    pagePresetName.set(laneId, `user:${trimmed}`);
    refreshInstrumentPresetSelect();
  });

  document.getElementById('instrument-preset-delete')?.addEventListener('click', async () => {
    const val = selectEl()?.value ?? '';
    if (!val.startsWith('user:')) {
      void alertDialog('Only user presets can be deleted (not the Factory ones).');
      return;
    }
    const name = val.slice('user:'.length);
    if (!await confirmDialog(`Delete preset "${name}"?`)) return;
    const laneId = deps.getActiveEngineLaneId();
    deleteUserPreset(deps.getLaneEngineId(laneId), name);
    populateInstrumentPresetSelect();
  });
}
