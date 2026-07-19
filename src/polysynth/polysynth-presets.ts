import { PolySynth, POLY_DEFAULTS, type PolySynthParams } from './polysynth';
import { alertDialog, confirmDialog, promptDialog } from '../core/dialog';
import { randomizePolySynth } from '../core/random';
import type { SynthEngine } from '../engines/engine-types';
import { getCachedPresets } from '../presets/preset-loader';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { getDrumKits, loadDrumKits, type DrumKitPreset } from '../presets/drum-kits-loader';
import { listDrumkits } from '../samples/drumkit-loader';
import { listInstruments } from '../samples/instrument-loader';
import {
  flatToPolyParams, polyParamsToFlat, getFactoryPolyPresets, polyPresetName,
  loadUserPolyPresets, saveUserPolyPresets,
} from './poly-preset-store';
// Re-export the store surface so existing importers of './polysynth-presets' keep working.
export { polyParamsToFlat, polyPresetName, loadUserPolyPresets, saveUserPolyPresets } from './poly-preset-store';

// Bumped on every #poly-preset-select population so a slow async fill (the
// sampler's instrument list) bails if the user has since switched lanes.
let polyPopGen = 0;

export interface PolySynthPresetsDeps {
  // Phase G: may return null before boot lane is allocated.
  getActivePolyTarget: () => PolySynth | null;
  getActiveEngineLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  rebuildEngineParamUI: () => void;
  /** Push current engine base values back into the lane's knob UI handles
   *  after a preset or randomize mutates the underlying state. */
  refreshLaneKnobs: (laneId: string) => void;
  /** When provided, user-initiated preset changes (dropdown select / Load
   *  button click) are wrapped with withUndo so each becomes one undoable
   *  entry. Omit for programmatic/session-load callers. */
  historyDeps?: HistoryDeps;
  /** Apply a unified drum-kit preset (synth or sample) to a drums lane — the
   *  ctx-aware orchestrator (session-host.applyDrumPreset). */
  applyDrumKitPreset?: (laneId: string, name: string) => void;
}

let _deps: PolySynthPresetsDeps | null = null;

export function applyPolyParams(params: PolySynthParams): void {
  const target = _deps!.getActivePolyTarget();
  if (!target) return;
  const d = JSON.parse(JSON.stringify(target.params)) as PolySynthParams;
  target.params = {
    master: { ...d.master, ...params.master },
    osc1:   { ...d.osc1,   ...params.osc1 },
    osc2:   { ...d.osc2,   ...params.osc2 },
    sub:    { ...d.sub,    ...params.sub },
    noise:  { ...d.noise,  ...params.noise },
    filter: { ...d.filter, ...params.filter },
    amp:    { ...d.amp,    ...params.amp },
  };
  _deps!.refreshLaneKnobs(_deps!.getActiveEngineLaneId());
}

export function applyPresetByName(poly: PolySynth, name: string): void {
  const presets = getFactoryPolyPresets();
  const p = presets.find((x) => x.name === name);
  if (p) {
    poly.params = JSON.parse(JSON.stringify(p.params)) as PolySynthParams;
    polyPresetName.set(poly, `factory:${name}`);
  }
}

export function refreshPolyPresetSelect(): void {
  const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  if (!sel) return;
  // FM / Wavetable / Karplus poly lanes have no PolySynth instance to key
  // polyPresetName by, so fall back to the lane-keyed memory (engine:<name>,
  // filled by recordPagePresetForLane on load + on preset change). After the
  // Phase 4 cutover subtractive lanes have no PolySynth target either, so
  // their selection is also tracked in the lane-keyed pagePresetName (set by
  // the user: change handler + Save). All poly engines now read it here.
  const laneId = _deps?.getActiveEngineLaneId();
  sel.value = (laneId && pagePresetName.get(laneId)) || '__custom__';
}

/** Core implementation: populate #poly-preset-select using an explicit laneId.
 *  Exposed as a separate helper so injectEngineModulatorPanel can call it for
 *  FM/Wavetable/Karplus poly lanes without relying on getActiveEngineLaneId()
 *  (which is only updated for subtractive via the showPolyEditor path). */
export function populatePolyPresetSelectForLane(laneId: string): void {
  const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  if (!sel) return;
  sel.innerHTML = '';
  const gen = ++polyPopGen;

  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = '(custom — no preset)';
  sel.appendChild(custom);

  const deps = _deps;
  if (!deps) return;
  const engineId = deps.getLaneEngineId(laneId);

  // Sampler: its PRESET dropdown lists normal presets (presets/sampler.json —
  // melodic multi-zone instruments) plus the bundled drumkits and loops. Normal
  // presets are cached at boot so they fill synchronously; drumkits/loops load
  // from their own indexes. Selecting one runs SamplerEngine.loadFamilyRef (see
  // the change handler). The async fill bails if the user switched lanes.
  if (engineId === 'sampler') {
    const group = (s: HTMLSelectElement, label: string, items: [string, string][]): void => {
      if (!items.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const [val, text] of items) {
        const o = document.createElement('option');
        o.value = val; o.textContent = text;
        g.appendChild(o);
      }
      s.appendChild(g);
    };
    // Synchronous: normal presets are already in the cache.
    group(sel, 'Presets', getCachedPresets('sampler').map((p) => [`sampler:preset:${p.name}`, p.name]));
    void Promise.all([listDrumkits(), listInstruments()]).then(([kits, instruments]) => {
      if (gen !== polyPopGen) return;
      const s = document.getElementById('poly-preset-select') as HTMLSelectElement | null;
      if (!s) return;
      group(s, 'Drumkit', kits.map((k) => [`sampler:drumkit:${k.id}`, k.name]));
      group(s, 'Loop', instruments.filter((i) => i.family === 'loop').map((i) => [`sampler:loop:${i.id}`, i.name]));
      s.value = pagePresetName.get(laneId) ?? '__custom__';
    });
    sel.value = pagePresetName.get(laneId) ?? '__custom__';
    return;
  }

  if (engineId === 'subtractive') {
    const factoryGroup = document.createElement('optgroup');
    factoryGroup.label = 'Factory';
    for (const p of getFactoryPolyPresets()) {
      const opt = document.createElement('option');
      // Unified vocabulary: subtractive factory presets are `engine:<name>` like
      // every other engine's (they're applied the same way, engine.applyPreset).
      opt.value = `engine:${p.name}`;
      opt.textContent = p.name;
      factoryGroup.appendChild(opt);
    }
    sel.appendChild(factoryGroup);

    const user = loadUserPolyPresets();
    const userNames = Object.keys(user).sort();
    if (userNames.length > 0) {
      const userGroup = document.createElement('optgroup');
      userGroup.label = 'User';
      for (const name of userNames) {
        const opt = document.createElement('option');
        opt.value = `user:${name}`;
        opt.textContent = name;
        userGroup.appendChild(opt);
      }
      sel.appendChild(userGroup);
    }
    return;
  }

  // Non-subtractive poly engine (FM, Wavetable, Karplus): pull presets
  // directly from the lane's SynthEngine instance.
  const instance = deps.getLaneEngineInstance(laneId);
  if (!instance) return;
  const presets = instance.presets ?? [];
  if (presets.length === 0) return;
  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory';
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = `engine:${p.name}`;
    opt.textContent = p.name;
    factoryGroup.appendChild(opt);
  }
  sel.appendChild(factoryGroup);
}

export function populatePolyPresetSelect(): void {
  const deps = _deps;
  if (!deps) return;
  populatePolyPresetSelectForLane(deps.getActiveEngineLaneId());
}

/** Apply a USER subtractive preset (stored as nested PolySynthParams) to a lane's
 *  worklet engine: flatten to dot-ids + setBaseValue each, then refresh the lane
 *  knobs. The Phase 4 cutover removed the PolySynth target these used to write to. */
function applySubtractiveUserPreset(laneId: string, params: PolySynthParams): void {
  const deps = _deps;
  if (!deps) return;
  const engine = deps.getLaneEngineInstance(laneId);
  if (!engine) return;
  const flat = polyParamsToFlat(params);
  for (const [id, v] of Object.entries(flat)) engine.setBaseValue(id, v);
  deps.refreshLaneKnobs(laneId);
}

/** Apply a non-subtractive engine preset to the active lane's engine
 *  instance, then refresh the knob UI.
 *
 *  Delegates to `engine.applyPreset(name)` — the SAME path the session/scene
 *  loader uses (preset-apply.ts::applyPresetToEngine). Each engine owns the
 *  mapping from its preset JSON keys to its internal state; a generic
 *  `setBaseValue(jsonKey, value)` loop here is WRONG because some engines'
 *  preset keys are not setBaseValue ids (tb303: `cutoff`/`envMod`… vs
 *  `filter.cutoff`/`env.amount`; drums: `kitId`) — those silently no-op,
 *  which is why changing a 303 preset did nothing. */
function applyEnginePreset(presetName: string): void {
  const deps = _deps!;
  applyEnginePresetForLane(presetName, deps.getActiveEngineLaneId());
}

/** Apply a non-subtractive engine preset by id to a specific named lane,
 *  refreshing the knob UI. Used by the per-page preset controls for 303
 *  and drums lanes (which are not "active poly" lanes). */
function applyEnginePresetForLane(presetName: string, laneId: string): void {
  const deps = _deps;
  if (!deps) return;
  const instance = deps.getLaneEngineInstance(laneId);
  if (!instance) return;
  instance.applyPreset(presetName);
  deps.refreshLaneKnobs(laneId);
}

// ── Per-page preset controls (TB-303, Drums) ──────────────────────────────

/** Tracks which preset is selected on each per-page select by laneId.
 *  Used by refreshPagePresetSelect to restore the correct selection on
 *  lane re-activation. */
const pagePresetName = new Map<string, string>();

/** Mutable active-lane holder per select element id. Shared between
 *  populate (writes) and the change listener (reads) so the listener always
 *  targets the lane that is currently displayed, even when two different
 *  lanes of the same engine type share the same static select element. */
const pageSelectActiveLane = new Map<string, { laneId: string }>();

/** Populate the preset <select> identified by `selectId` with presets for
 *  the given engineId. Adds a leading "(custom — no preset)" option, then
 *  a Factory optgroup. */
export function populateEnginePresetSelectById(
  selectId: string,
  engineId: string,
  laneId: string,
): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;

  // Update the mutable active-lane holder so the pre-wired listener targets
  // the newly activated lane.
  let holder = pageSelectActiveLane.get(selectId);
  if (!holder) {
    holder = { laneId };
    pageSelectActiveLane.set(selectId, holder);
  } else {
    holder.laneId = laneId;
  }

  sel.innerHTML = '';

  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = '(custom — no preset)';
  sel.appendChild(custom);

  const deps = _deps;
  if (!deps) return;
  const instance = deps.getLaneEngineInstance(laneId);
  if (!instance) return;
  const presets = instance.presets ?? [];
  if (presets.length === 0) return;

  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory';
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = `engine:${p.name}`;
    opt.textContent = p.name;
    factoryGroup.appendChild(opt);
  }
  sel.appendChild(factoryGroup);

  // Restore previous selection if any.
  const prev = pagePresetName.get(laneId);
  if (prev) sel.value = prev;
  else sel.value = '__custom__';
}

/** Wire the change + Load button listeners for a per-page preset select.
 *  Safe to call multiple times — guards against double-wiring with a data
 *  attribute on the element. The listener reads from the shared active-lane
 *  holder (set by populateEnginePresetSelectById) so it always applies to
 *  the currently displayed lane even if two lanes share the same element. */
export function wireEnginePresetSelectById(
  selectId: string,
  loadBtnId: string,
): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  // Guard: only wire the element once across all lane activations.
  if (sel.dataset.presetWired === '1') return;
  sel.dataset.presetWired = '1';

  const applySelected = () => {
    const holder = pageSelectActiveLane.get(selectId);
    if (!holder) return;
    const activeLaneId = holder.laneId;
    const val = sel.value;
    if (!val || val === '__custom__') return;
    if (val.startsWith('engine:')) {
      const name = val.slice('engine:'.length);
      applyEnginePresetForLane(name, activeLaneId);
      pagePresetName.set(activeLaneId, val);
    }
  };

  sel.addEventListener('change', () => {
    if (_deps?.historyDeps) withUndo(_deps.historyDeps, applySelected);
    else applySelected();
  });

  const loadBtn = document.getElementById(loadBtnId) as HTMLButtonElement | null;
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      if (_deps?.historyDeps) withUndo(_deps.historyDeps, applySelected);
      else applySelected();
    });
  }
}

/** Mark a per-page preset select as "custom" (no preset). Called after a
 *  sound-randomize action so the dropdown reflects that the current sound
 *  no longer matches any saved preset. */
export function markPagePresetCustom(selectId: string, laneId: string): void {
  pagePresetName.delete(laneId);
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (sel) sel.value = '__custom__';
}

/** Record a lane's per-page (303 / drums) preset selection so the dropdown
 *  reflects it after a session/demo load — applyPresetForLane applies the
 *  sound, but nothing sets pagePresetName otherwise, so the select came up
 *  "(custom — no preset)". Normalizes any prefix to the dropdown's
 *  `engine:<name>` option vocabulary and live-updates a currently-shown
 *  select. Harmless for poly-page engines (their dropdown is
 *  poly-preset-select, which never reads pagePresetName). */
export function recordPagePresetForLane(laneId: string, presetName: string): void {
  // Record the value VERBATIM. It already carries the canonical dropdown
  // vocabulary — `engine:<name>` for every built-in preset, `user:<name>` for
  // subtractive user presets, `sampler:…` for the sampler — so it always matches
  // an option. This USED to force `engine:<name>`, which matched the FM/303/drums
  // selects but NOT subtractive's `factory:` options nor the sampler's `sampler:`
  // options, so those lanes came up blank on load (correct sound, no preset).
  pagePresetName.set(laneId, presetName);
  for (const [selectId, holder] of pageSelectActiveLane) {
    if (holder.laneId === laneId) {
      const sel = document.getElementById(selectId) as HTMLSelectElement | null;
      if (sel) sel.value = presetName;
    }
  }
}

/** Mark the poly preset select as "custom" and forget the lane's preset
 *  binding. Called after sound-randomize on poly engines. */
export function markPolyPresetCustom(): void {
  const target = _deps?.getActivePolyTarget();
  if (target) polyPresetName.delete(target);
  // Poly lanes (incl. subtractive after the cutover) track selection in the
  // lane-keyed pagePresetName; clear the active lane's entry too.
  const laneId = _deps?.getActiveEngineLaneId();
  if (laneId) pagePresetName.delete(laneId);
  const sel = document.getElementById('poly-preset-select') as HTMLSelectElement | null;
  if (sel) sel.value = '__custom__';
}

/** Refresh the selection indicator on a per-page preset select after an
 *  external change (e.g. session load). */
export function refreshEnginePresetSelectById(selectId: string, laneId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  const prev = pagePresetName.get(laneId);
  sel.value = prev ?? '__custom__';
}

/** Called by injectEngineModulatorPanel when the 303 page is activated for
 *  a TB-303 lane. Populates + wires (on first visit) the bass preset select. */
export function mountBassPresetSelect(laneId: string): void {
  populateEnginePresetSelectById('bass-preset-select', 'tb303', laneId);
  wireEnginePresetSelectById('bass-preset-select', 'bass-preset-load');
}

/** Called by injectEngineModulatorPanel when the drums page is activated.
 *  Populates the drums preset <select> from the unified drum-kits.json list
 *  (grouped Synth / Samples) and wires change/Load to the ctx-aware
 *  orchestrator. Option values keep the `engine:<name>` vocabulary so
 *  pagePresetName / refresh helpers keep working. */
export function mountDrumsPresetSelect(laneId: string): void {
  populateDrumKitsSelect(laneId);
  wireDrumKitsSelect('drums-preset-select', 'drums-preset-load');
}

function populateDrumKitsSelect(laneId: string): void {
  const sel = document.getElementById('drums-preset-select') as HTMLSelectElement | null;
  if (!sel) return;

  let holder = pageSelectActiveLane.get('drums-preset-select');
  if (!holder) { holder = { laneId }; pageSelectActiveLane.set('drums-preset-select', holder); }
  else holder.laneId = laneId;

  const render = () => {
    sel.innerHTML = '';
    const custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = '(custom — no preset)';
    sel.appendChild(custom);

    const kits = getDrumKits();
    const groups = new Map<string, DrumKitPreset[]>();
    for (const k of kits) {
      const arr = groups.get(k.group) ?? [];
      arr.push(k);
      groups.set(k.group, arr);
    }
    for (const [group, entries] of groups) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const k of entries) {
        const opt = document.createElement('option');
        opt.value = `engine:${k.name}`;
        opt.textContent = k.name;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    const prev = pagePresetName.get(laneId);
    sel.value = prev ?? '__custom__';
  };

  render();
  // If the loader hasn't resolved yet, re-render when it does (boot race).
  if (getDrumKits().length === 0) void loadDrumKits().then(render);
}

function wireDrumKitsSelect(selectId: string, loadBtnId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  if (sel.dataset.presetWired === '1') return;
  sel.dataset.presetWired = '1';

  const applySelected = () => {
    const holder = pageSelectActiveLane.get(selectId);
    if (!holder) return;
    const val = sel.value;
    if (!val || val === '__custom__') return;
    if (!val.startsWith('engine:')) return;
    const name = val.slice('engine:'.length);
    // Record the selection BEFORE applying: applyDrumKitPreset rebuilds the drums
    // inspector synchronously (unified picker), which re-populates this select and
    // reads pagePresetName. Setting it after made the dropdown snap back to
    // "(custom — no preset)" mid-apply.
    pagePresetName.set(holder.laneId, val);
    _deps?.applyDrumKitPreset?.(holder.laneId, name);
  };

  sel.addEventListener('change', () => {
    if (_deps?.historyDeps) withUndo(_deps.historyDeps, applySelected);
    else applySelected();
  });
  const loadBtn = document.getElementById(loadBtnId) as HTMLButtonElement | null;
  loadBtn?.addEventListener('click', () => {
    if (_deps?.historyDeps) withUndo(_deps.historyDeps, applySelected);
    else applySelected();
  });
}

export function wirePolyControls(deps: PolySynthPresetsDeps): void {
  _deps = deps;

  const btn = document.getElementById('poly-randomize') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const laneId = deps.getActiveEngineLaneId();
    const engineId = deps.getLaneEngineId(laneId);
    if (engineId === 'subtractive') {
      // After the Phase 4 cutover subtractive lanes have no PolySynth; randomize a
      // fresh PolySynthParams bag (randomizePolySynth only mutates .params — no
      // audio nodes), flatten to dot-ids and push to the worklet engine via
      // setBaseValue (the same path the user-preset load uses).
      const engine = deps.getLaneEngineInstance(laneId);
      if (!engine) return;
      const scratch = { params: JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams } as PolySynth;
      randomizePolySynth(scratch);
      const flat = polyParamsToFlat(scratch.params);
      for (const [id, v] of Object.entries(flat)) engine.setBaseValue(id, v);
      deps.refreshLaneKnobs(laneId);
      markPolyPresetCustom();
      return;
    }
    const instance = deps.getLaneEngineInstance(laneId);
    if (!instance) return;
    const eng = instance as unknown as { randomize?: () => void; setParam?: (id: string, v: number) => void };
    if (eng.randomize) {
      eng.randomize();
    } else {
      for (const p of instance.params) {
        const v = p.min + Math.random() * (p.max - p.min);
        eng.setParam?.(p.id, v);
      }
    }
    deps.rebuildEngineParamUI();
    markPolyPresetCustom();
  });

  populatePolyPresetSelect();

  const loadCurrentPreset = () => {
    const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
    const val = sel.value;
    if (!val || val === '__custom__') return;

    // Sampler: a "preset" is a bundled instrument ref ('sampler:drumkit:tr808', …).
    // Load it through the engine (async fetch + decode + keymap + id mirror).
    if (val.startsWith('sampler:')) {
      const ref = val.slice('sampler:'.length);
      const laneId = deps.getActiveEngineLaneId();
      const instance = deps.getLaneEngineInstance(laneId) as unknown as { loadFamilyRef?: (r: string) => Promise<void> } | null;
      void instance?.loadFamilyRef?.(ref);
      pagePresetName.set(laneId, val);
      return;
    }

    // Handle engine-prefixed presets FIRST — they resolve via getLaneEngineInstance
    // and do NOT need a PolySynth target. (FM, Wavetable, Karplus all reach this path.)
    if (val.startsWith('engine:')) {
      const name = val.slice('engine:'.length);
      const laneId = deps.getActiveEngineLaneId();
      applyEnginePresetForLane(name, laneId);
      // Record the selection so refreshPolyPresetSelect restores it when the
      // lane is re-activated (tab switch). Without this, FM/Wavetable/Karplus
      // lanes always came back showing "(custom — no preset)". `val` is already
      // the `engine:<name>` dropdown vocabulary pagePresetName is keyed by.
      pagePresetName.set(laneId, val);
      return;
    }

    // user: presets target the active subtractive lane's WORKLET engine (the
    // legacy PolySynth target is gone after the Phase 4 cutover). They're
    // stored as PolySynthParams → flattened to dot-ids and pushed through
    // setBaseValue, then the lane knobs refresh.
    const laneId = deps.getActiveEngineLaneId();
    if (val.startsWith('user:')) {
      const name = val.slice('user:'.length);
      const presets = loadUserPolyPresets();
      if (presets[name]) {
        applySubtractiveUserPreset(laneId, presets[name]);
        pagePresetName.set(laneId, val);
      }
    }
  };

  // Auto-load on change — selecting a preset applies it immediately, no Load
  // button needed. The Load button stays as a no-op fallback for now (in case
  // the user wants to re-apply the current selection).
  const presetSel = document.getElementById('poly-preset-select') as HTMLSelectElement;
  presetSel.addEventListener('change', () => {
    if (deps.historyDeps) withUndo(deps.historyDeps, loadCurrentPreset);
    else loadCurrentPreset();
  });
  (document.getElementById('poly-preset-load') as HTMLButtonElement)
    .addEventListener('click', () => {
      if (deps.historyDeps) withUndo(deps.historyDeps, loadCurrentPreset);
      else loadCurrentPreset();
    });

  (document.getElementById('poly-preset-save') as HTMLButtonElement).addEventListener('click', async () => {
    const name = await promptDialog('Preset name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    // Snapshot the active subtractive lane's worklet engine params (the legacy
    // PolySynth target is gone). Read each subtractive dot-id base value, then
    // expand to the nested PolySynthParams shape user presets are stored in.
    const laneId = deps.getActiveEngineLaneId();
    const engine = deps.getLaneEngineInstance(laneId);
    if (!engine) return;
    const flat: Record<string, number> = {};
    for (const id of Object.keys(polyParamsToFlat(POLY_DEFAULTS))) flat[id] = engine.getBaseValue(id);
    const presets = loadUserPolyPresets();
    presets[trimmed] = flatToPolyParams(flat);
    saveUserPolyPresets(presets);
    populatePolyPresetSelect();
    pagePresetName.set(laneId, `user:${trimmed}`);
    refreshPolyPresetSelect();
  });

  (document.getElementById('poly-preset-delete') as HTMLButtonElement).addEventListener('click', async () => {
    const sel = document.getElementById('poly-preset-select') as HTMLSelectElement;
    const val = sel.value;
    if (!val.startsWith('user:')) {
      void alertDialog('Only user presets can be deleted (not the Factory ones).');
      return;
    }
    const name = val.slice('user:'.length);
    if (!await confirmDialog(`Delete preset "${name}"?`)) return;
    const presets = loadUserPolyPresets();
    delete presets[name];
    saveUserPolyPresets(presets);
    populatePolyPresetSelect();
  });
}

