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
import { alertDialog, confirmDialog, promptDialog } from '../core/dialog';
import { applyEnginePresetToLane, applyUserPresetToLane } from './poly-preset-apply';
import {
  snapshotEngineParams, loadUserPresets, saveUserPreset, deleteUserPreset,
} from './user-preset-store';
import { getFactoryPolyPresets } from './poly-preset-store';
import { getCachedPresets } from '../presets/preset-loader';
import { listDrumkits } from '../samples/drumkit-loader';
import { listInstruments } from '../samples/instrument-loader';
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

/** Point the dropdown at whatever the active lane has selected. */
export function refreshInstrumentPresetSelect(): void {
  const sel = selectEl();
  if (!sel) return;
  const laneId = presetControlsDeps()?.getActiveEngineLaneId();
  sel.value = (laneId && pagePresetName.get(laneId)) || '__custom__';
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

  // The sampler's "presets" are bundled instrument refs, not param bags: normal
  // presets (presets/sampler.json — melodic multi-zone instruments) plus the
  // drumkits and loops. Normal presets are cached at boot so they fill
  // synchronously; the other two load from their own indexes, and that fill
  // bails if the user switched lanes while it was in flight.
  if (engineId === 'sampler') {
    const presetItems: [string, string][] =
      getCachedPresets('sampler').map((p) => [`sampler:preset:${p.name}`, p.name]);
    renderInto(sel, html`${customOption()}${presetGroup('Presets', presetItems)}`);
    void Promise.all([listDrumkits(), listInstruments()]).then(([kits, instruments]) => {
      if (gen !== popGen) return;
      const s = selectEl();
      if (!s) return;
      renderInto(s, html`${customOption()}${presetGroup('Presets', presetItems)}${presetGroup(
        'Drumkit', kits.map((k) => [`sampler:drumkit:${k.id}`, k.name] as [string, string]),
      )}${presetGroup(
        'Loop',
        instruments.filter((i) => i.family === 'loop').map((i) => [`sampler:loop:${i.id}`, i.name] as [string, string]),
      )}`);
      s.value = pagePresetName.get(laneId) ?? '__custom__';
    });
    sel.value = pagePresetName.get(laneId) ?? '__custom__';
    return;
  }

  // Every melodic engine gets the same two groups. Subtractive is the only one
  // whose factory list does not come off the engine instance: its presets are
  // stored flat and expanded through the nested shape its old user presets
  // share. Both are `engine:<name>` and both apply the same way.
  const factory: [string, string][] = engineId === 'subtractive'
    ? getFactoryPolyPresets().map((p) => [`engine:${p.name}`, p.name])
    : (deps.getLaneEngineInstance(laneId)?.presets ?? []).map((p) => [`engine:${p.name}`, p.name]);

  // The User group is per ENGINE, not global: a preset saved on an FM lane is
  // FM's vocabulary and means nothing to subtractive.
  const user: [string, string][] = Object.keys(loadUserPresets(engineId)).sort()
    .map((name) => [`user:${name}`, name]);

  renderInto(sel, html`${customOption()}${presetGroup('Factory', factory)}${presetGroup('User', user)}`);
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
    if (!deleteUserPreset(deps.getLaneEngineId(laneId), name)) {
      // The only presets this store cannot delete are the subtractive ones saved
      // before it existed: they live in a key it never writes, and rewriting
      // that key to drop one entry would put the rest at risk.
      void alertDialog(`"${name}" was saved by an older version and cannot be deleted here.`);
      return;
    }
    populateInstrumentPresetSelect();
  });
}
