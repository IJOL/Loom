import { listPlugins } from '../plugins/registry';
import { getEngine } from './registry';
import { populatePolyPresetSelect, refreshPolyPresetSelect } from '../polysynth/polysynth-presets';
import type { KnobHandle } from '../core/knob';
import { withUndo, type HistoryDeps } from '../save/history-wiring';

export interface EngineSelectorUIDeps {
  engineSel: HTMLSelectElement;
  getActiveLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  automationRegistry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  populateAutoParamSelect: () => void;
  /** Called by `rebuildEngineParamUI` when the active engine is Subtractive
   *  to re-mount the per-section knobs into the index.html divs and
   *  re-register their handles in the automation registry. The Subtractive
   *  knobs are stable in DOM but their registry entries get evicted by
   *  `unregisterKnobsByPrefix` (which exists to clear knobs from other
   *  engines), so this hook re-populates them so the modulator destination
   *  dropdown isn't empty. */
  remountSubtractiveLaneKnobs?: (laneId: string) => void;
  /** Called UNCONDITIONALLY by `rebuildEngineParamUI` (for every engine) after
   *  the prefix unregister, so the per-lane FX panel's knobs (which sit at
   *  `<laneId>.fx.*` and would otherwise be lost across engine switches) get
   *  re-registered. The hook also re-paints the FX panel DOM. */
  remountLaneFxPanel?: (laneId: string) => void;
  /** When provided, user-initiated engine changes are wrapped with withUndo
   *  so each selection becomes one undoable entry. Omit for programmatic/
   *  session-load callers so those do not pollute the undo stack. */
  historyDeps?: HistoryDeps;
}

/** EngineIds eligible for the swap dropdown: registered 'synth' plugins whose
 *  engine uses the piano-roll editor. drum-grid engines (drums-machine) edit
 *  on the drum-grid page and are excluded. */
export function melodicSynthEngineIds(): string[] {
  return listPlugins('synth')
    .map((p) => p.manifest.id)
    .filter((id) => getEngine(id)?.editor === 'piano-roll');
}

let _deps: EngineSelectorUIDeps | null = null;
let _engineParamEl: HTMLDivElement | null = null;
let _polyPage: Element | null = null;

export function unregisterKnobsByPrefix(prefix: string, automationRegistry: Map<string, KnobHandle>): void {
  for (const id of Array.from(automationRegistry.keys())) {
    if (id.startsWith(prefix)) automationRegistry.delete(id);
  }
}

export function rebuildEngineParamUI(): void {
  const deps = _deps!;
  const engineParamEl = _engineParamEl!;
  const polyPage = _polyPage!;

  engineParamEl.innerHTML = '';
  // Drop any previously-registered knobs for this lane so we don't accumulate
  // stale handles in the automation registry.
  const activeLaneId = deps.getActiveLaneId();
  unregisterKnobsByPrefix(`${activeLaneId}.`, deps.automationRegistry);

  // Show/hide subtractive-specific rows based on the ACTIVE lane's engine
  const engineId = deps.getLaneEngineId(activeLaneId);
  const subtractiveRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
  for (const row of subtractiveRows) {
    row.style.display = engineId === 'subtractive' ? '' : 'none';
  }
  // Re-mount the per-lane FX panel unconditionally so its knobs (laneId.fx.*)
  // are re-registered after the prefix unregister above, regardless of engine.
  deps.remountLaneFxPanel?.(activeLaneId);
  // Re-mount Subtractive per-section knobs so their registry entries are
  // alive again after the prefix unregister above. Without this the
  // modulator destination dropdown comes up empty for Subtractive lanes.
  if (engineId === 'subtractive') deps.remountSubtractiveLaneKnobs?.(activeLaneId);
  // The modulators panel is rendered via SessionHost.injectEngineModulatorPanel
  // for ALL lanes (single source of truth). engine-params is no longer used by
  // the modulators UI; hide it to avoid an empty container in the layout.
  engineParamEl.style.display = 'none';
  // Refresh the preset dropdown so it reflects the active lane's engine —
  // subtractive lanes show PolySynth factory + user presets; other engines
  // show their own SynthEngine.presets array (filtered by engine).
  populatePolyPresetSelect();
  refreshPolyPresetSelect();
  deps.populateAutoParamSelect();
}

export function populateEngineSelect(deps: EngineSelectorUIDeps, currentEngineId: string): void {
  deps.engineSel.innerHTML = '';
  // Keep the original plugin manifest labels (e.g. "TB-303", "Subtractive");
  // only the melodic-engine filter changes vs. the legacy behavior.
  const melodic = new Set(melodicSynthEngineIds());
  for (const plugin of listPlugins('synth')) {
    if (!melodic.has(plugin.manifest.id)) continue;
    const opt = document.createElement('option');
    opt.value = plugin.manifest.id;
    opt.textContent = plugin.manifest.name;
    if (plugin.manifest.id === currentEngineId) opt.selected = true;
    deps.engineSel.appendChild(opt);
  }
}

export function wireEngineSelector(deps: EngineSelectorUIDeps, initialEngineId: string): void {
  _deps = deps;

  // Build the engine-params container and insert it into the poly page
  const polyPage = document.querySelector('[data-page="poly"]')!;
  _polyPage = polyPage;
  const engineParamEl = document.createElement('div');
  engineParamEl.id = 'engine-params';
  engineParamEl.style.display = 'none';
  _engineParamEl = engineParamEl;
  const firstPolyRow = polyPage.querySelector('.poly-section')!;
  firstPolyRow.parentNode!.insertBefore(engineParamEl, firstPolyRow.nextSibling);

  populateEngineSelect(deps, initialEngineId);

  deps.engineSel.addEventListener('change', () => {
    const run = () => rebuildEngineParamUI();
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  });
}
