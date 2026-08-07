import { html } from 'lit-html';
import { renderInto } from '../core/lit-fill';
import { customOption, presetGroup } from './poly-preset-templates';
import { POLY_DEFAULTS, type PolySynthParams } from './poly-params';
import { alertDialog, confirmDialog, promptDialog } from '../core/dialog';
import {
  applyEnginePresetToLane, applyUserPolyPresetToLane,
} from './poly-preset-apply';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionState } from '../session/session';
import { getCachedPresets } from '../presets/preset-loader';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { getDrumKits, loadDrumKits, type DrumKitPreset } from '../presets/drum-kits-loader';
import { listDrumkits } from '../samples/drumkit-loader';
import { listInstruments } from '../samples/instrument-loader';
import {
  flatToPolyParams, polyParamsToFlat, getFactoryPolyPresets,
  loadUserPolyPresets, saveUserPolyPresets,
} from './poly-preset-store';
// Re-export the store surface so existing importers of './polysynth-presets' keep working.
export { polyParamsToFlat, loadUserPolyPresets, saveUserPolyPresets } from './poly-preset-store';

// Bumped on every #instrument-preset-select population so a slow async fill (the
// sampler's instrument list) bails if the user has since switched lanes.
let polyPopGen = 0;

export interface PolySynthPresetsDeps {
  getActiveEngineLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  /** The live session. Required, not optional: it is how a preset recall
   *  reaches a save (poly-preset-apply commits the applied base values into the
   *  lane), and an absent one loses the sound silently. */
  getSessionState: () => SessionState | undefined;
  /** Push current engine base values back into the lane's knob UI handles after
   *  a preset mutates the underlying state. (`rebuildEngineParamUI` used to sit
   *  next to this and is gone: its only caller here was the dice, and rebuilding
   *  is what unregistered the lane's knobs. Repaint, never rebuild.) */
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


export function refreshPolyPresetSelect(): void {
  const sel = document.getElementById('instrument-preset-select') as HTMLSelectElement;
  if (!sel) return;
  // FM / Wavetable poly lanes have no PolySynth instance to key
  // polyPresetName by, so fall back to the lane-keyed memory (engine:<name>,
  // filled by recordPagePresetForLane on load + on preset change). After the
  // Phase 4 cutover subtractive lanes have no PolySynth target either, so
  // their selection is also tracked in the lane-keyed pagePresetName (set by
  // the user: change handler + Save). All poly engines now read it here.
  const laneId = _deps?.getActiveEngineLaneId();
  sel.value = (laneId && pagePresetName.get(laneId)) || '__custom__';
}

/** Core implementation: populate #instrument-preset-select using an explicit laneId.
 *  Exposed as a separate helper so injectEngineModulatorPanel can call it for
 *  FM/Wavetable poly lanes without relying on getActiveEngineLaneId()
 *  (which is only updated for subtractive via the showPolyEditor path). */
export function populatePolyPresetSelectForLane(laneId: string): void {
  const sel = document.getElementById('instrument-preset-select') as HTMLSelectElement;
  if (!sel) return;
  const gen = ++polyPopGen;

  const deps = _deps;
  if (!deps) {
    renderInto(sel, html`${customOption()}`);
    return;
  }
  const engineId = deps.getLaneEngineId(laneId);

  // Sampler: its PRESET dropdown lists normal presets (presets/sampler.json —
  // melodic multi-zone instruments) plus the bundled drumkits and loops. Normal
  // presets are cached at boot so they fill synchronously; drumkits/loops load
  // from their own indexes. Selecting one runs SamplerEngine.loadFamilyRef (see
  // the change handler). The async fill bails if the user switched lanes.
  if (engineId === 'sampler') {
    // Synchronous: normal presets are already in the cache.
    const presetItems: [string, string][] =
      getCachedPresets('sampler').map((p) => [`sampler:preset:${p.name}`, p.name]);
    renderInto(sel, html`${customOption()}${presetGroup('Presets', presetItems)}`);
    void Promise.all([listDrumkits(), listInstruments()]).then(([kits, instruments]) => {
      if (gen !== polyPopGen) return;
      const s = document.getElementById('instrument-preset-select') as HTMLSelectElement | null;
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

  if (engineId === 'subtractive') {
    // Unified vocabulary: subtractive factory presets are `engine:<name>` like
    // every other engine's (they're applied the same way, engine.applyPreset).
    const factory: [string, string][] =
      getFactoryPolyPresets().map((p) => [`engine:${p.name}`, p.name]);
    const userNames = Object.keys(loadUserPolyPresets()).sort();
    const user: [string, string][] = userNames.map((name) => [`user:${name}`, name]);
    renderInto(sel, html`${customOption()}${presetGroup('Factory', factory)}${presetGroup('User', user)}`);
    return;
  }

  // Non-subtractive poly engine (FM, Wavetable): pull presets
  // directly from the lane's SynthEngine instance.
  const presets = deps.getLaneEngineInstance(laneId)?.presets ?? [];
  renderInto(sel, html`${customOption()}${presetGroup(
    'Factory', presets.map((p) => [`engine:${p.name}`, p.name] as [string, string]),
  )}`);
}

export function populatePolyPresetSelect(): void {
  const deps = _deps;
  if (!deps) return;
  populatePolyPresetSelectForLane(deps.getActiveEngineLaneId());
}

/** Apply an engine preset by name to a specific lane. Used by the per-page
 *  preset controls for 303 and drums lanes (which are not "active poly" lanes)
 *  as well as by the poly dropdown for FM / Wavetable. */
function applyEnginePresetForLane(presetName: string, laneId: string): void {
  if (_deps) applyEnginePresetToLane(_deps, laneId, presetName);
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

// `populateEnginePresetSelectById` and `wireEnginePresetSelectById` lived here.
// Their ONLY caller was mountBassPresetSelect — the TB-303's own page: a second
// preset dropdown, with its own ids and its own wiring, doing the job
// #instrument-preset-select already does for every other melodic lane. That page is
// gone, and they went with it.

/** Forget a lane's preset binding and show "(custom — no preset)" on every
 *  select currently displaying that lane. Called after a dice roll: the sound
 *  no longer matches any saved preset.
 *
 *  This replaced two functions that differed only in how they found the select
 *  — one took its id, the other assumed "the active lane". They existed because
 *  the dice itself was written twice. */
export function markPresetCustomForLane(laneId: string): void {
  pagePresetName.delete(laneId);
  const setCustom = (selectId: string) => {
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (sel) sel.value = '__custom__';
  };
  for (const [selectId, holder] of pageSelectActiveLane) {
    if (holder.laneId === laneId) setCustom(selectId);
  }
  // #instrument-preset-select never registers a holder in pageSelectActiveLane (it is
  // populated per-lane by populatePolyPresetSelectForLane), so it is synced
  // explicitly when the lane it shows is the active one.
  if (_deps?.getActiveEngineLaneId() === laneId) setCustom('instrument-preset-select');
}

/** Record a lane's per-page (303 / drums) preset selection so the dropdown
 *  reflects it after a session/demo load — applyPresetForLane applies the
 *  sound, but nothing sets pagePresetName otherwise, so the select came up
 *  "(custom — no preset)". Normalizes any prefix to the dropdown's
 *  `engine:<name>` option vocabulary and live-updates a currently-shown
 *  select. Harmless for instrument-page engines (their dropdown is
 *  instrument-preset-select, which never reads pagePresetName). */
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

/** Refresh the selection indicator on a per-page preset select after an
 *  external change (e.g. session load). */
export function refreshEnginePresetSelectById(selectId: string, laneId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  const prev = pagePresetName.get(laneId);
  sel.value = prev ?? '__custom__';
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

  const paint = () => {
    const groups = new Map<string, DrumKitPreset[]>();
    for (const k of getDrumKits()) {
      const arr = groups.get(k.group) ?? [];
      arr.push(k);
      groups.set(k.group, arr);
    }
    renderInto(sel, html`${customOption()}${[...groups].map(([group, entries]) =>
      presetGroup(group, entries.map((k) => [`engine:${k.name}`, k.name] as [string, string])))}`);
    const prev = pagePresetName.get(laneId);
    sel.value = prev ?? '__custom__';
  };

  paint();
  // If the loader hasn't resolved yet, re-render when it does (boot race).
  if (getDrumKits().length === 0) void loadDrumKits().then(paint);
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

  // The "🎲 Sound" dice is NOT wired here. It lives in core/randomize-ui.ts,
  // which owns the one action both dice buttons run. It used to be duplicated
  // here, and this copy was the broken one: it called rebuildEngineParamUI —
  // the engine-swap tool — which unregisters the lane's knobs and only re-mounts
  // them for Subtractive, freezing every other engine's modulation rings.
  //
  // The per-engine branching that USED to sit here is gone for good and must not
  // come back: `subtractive` had a hand-tuned randomizePolySynth that rolled a
  // fresh bag from POLY_DEFAULTS (discarding the loaded preset), and every other
  // engine fell through to methods no engine implemented, so the click marked the
  // dropdown Custom and changed nothing. engines/engine-randomize.ts biases toward
  // each param's CURRENT value, so it explores AROUND the sound you have and
  // needs no per-engine knowledge.

  populatePolyPresetSelect();

  const loadCurrentPreset = () => {
    const sel = document.getElementById('instrument-preset-select') as HTMLSelectElement;
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
    // and do NOT need a PolySynth target. (FM and Wavetable both reach this path.)
    if (val.startsWith('engine:')) {
      const name = val.slice('engine:'.length);
      const laneId = deps.getActiveEngineLaneId();
      applyEnginePresetForLane(name, laneId);
      // Record the selection so refreshPolyPresetSelect restores it when the
      // lane is re-activated (tab switch). Without this, FM/Wavetable
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
        applyUserPolyPresetToLane(deps, laneId, presets[name]);
        pagePresetName.set(laneId, val);
      }
    }
  };

  // Auto-load on change — selecting a preset applies it immediately, no Load
  // button needed. The Load button stays as a no-op fallback for now (in case
  // the user wants to re-apply the current selection).
  const presetSel = document.getElementById('instrument-preset-select') as HTMLSelectElement;
  presetSel.addEventListener('change', () => {
    if (deps.historyDeps) withUndo(deps.historyDeps, loadCurrentPreset);
    else loadCurrentPreset();
  });
  (document.getElementById('instrument-preset-load') as HTMLButtonElement)
    .addEventListener('click', () => {
      if (deps.historyDeps) withUndo(deps.historyDeps, loadCurrentPreset);
      else loadCurrentPreset();
    });

  (document.getElementById('instrument-preset-save') as HTMLButtonElement).addEventListener('click', async () => {
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

  (document.getElementById('instrument-preset-delete') as HTMLButtonElement).addEventListener('click', async () => {
    const sel = document.getElementById('instrument-preset-select') as HTMLSelectElement;
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

