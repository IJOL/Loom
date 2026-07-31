import { html, render } from 'lit-html';
import { getEngineDescriptor, listEngines } from './registry';
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
  /** When provided, a selection swaps the active lane's engine via this
   *  callback. The change handler already wraps it in withUndo, so pass the
   *  raw flow here. When omitted, the handler falls back to rebuildEngineParamUI. */
  onEngineChange?: (laneId: string, newEngineId: string) => void;
}

/** EngineIds eligible for the swap dropdown: every registered ENGINE that uses
 *  the piano-roll editor. drum-grid engines (drums-machine) edit on the
 *  drum-grid page and are excluded.
 *
 *  The source list is the ENGINE registry, not listPlugins('synth'). Those are
 *  two different registries: listPlugins holds what the build-time
 *  `import.meta.glob` over src/ found, so a RUNTIME plugin — which registers its
 *  engine through Loom.registerEngine and never appears in that glob — could
 *  never show up in the selector while this read from there. That is not a
 *  cosmetic difference: it is the whole "a plugin is a first-class engine"
 *  claim, and it was broken for every plugin engine. */
export function melodicSynthEngineIds(): string[] {
  return listEngines('polyhost')
    .map((e) => e.id)
    .filter((id) => getEngineDescriptor(id)?.editor === 'piano-roll');
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

/** Rebuild `sel`'s options with the melodic engines (manifest labels). Renders
 *  into a fresh fragment each call: the select may be repopulated many times,
 *  and its options can be mutated elsewhere, so lit must never own the select's
 *  content across calls. */
function renderMelodicOptions(sel: HTMLSelectElement, currentEngineId: string): void {
  sel.innerHTML = '';
  // Keep the original plugin manifest labels (e.g. "TB-303", "Subtractive");
  // only the melodic-engine filter changes vs. the legacy behavior.
  const melodic = new Set(melodicSynthEngineIds());
  const frag = document.createDocumentFragment();
  // Same registry as melodicSynthEngineIds, for the same reason — the labels
  // have to come from wherever the ids came from, or a plugin engine would be
  // listed with no option to render.
  render(html`${listEngines('polyhost')
    .filter((e) => melodic.has(e.id))
    .map((e) => html`<option value=${e.id} ?selected=${e.id === currentEngineId}>${e.name}</option>`)}`, frag);
  sel.appendChild(frag);
}

export function populateEngineSelect(deps: EngineSelectorUIDeps, currentEngineId: string): void {
  renderMelodicOptions(deps.engineSel, currentEngineId);
}

export interface EngineSelector303Deps {
  engineSel303: HTMLSelectElement;
  /** The lane currently being edited (sessionHost.activeEditLane). */
  getActiveLaneId: () => string | null;
  /** Wrap-in-undo swap entry point. Receives the lane id + chosen engine id. */
  onEngineChange: (laneId: string, newEngineId: string) => void;
}

/** Populate a <select> with the 5 melodic engines (manifest labels). */
export function populateEngineSelect303(sel: HTMLSelectElement, currentEngineId: string): void {
  renderMelodicOptions(sel, currentEngineId);
}

/** Wire the 303-page engine selector: a change swaps the engine of the lane
 *  currently in edit. */
export function wireEngineSelector303(deps: EngineSelector303Deps): void {
  populateEngineSelect303(deps.engineSel303, 'tb303');
  deps.engineSel303.addEventListener('change', () => {
    const laneId = deps.getActiveLaneId();
    if (laneId) deps.onEngineChange(laneId, deps.engineSel303.value);
  });
}

export function wireEngineSelector(deps: EngineSelectorUIDeps, initialEngineId: string): void {
  _deps = deps;

  // Build the engine-params container and insert it into the poly page.
  // One-shot scaffolding: rendered into a fragment, the element pulled out.
  const polyPage = document.querySelector('[data-page="poly"]')!;
  _polyPage = polyPage;
  const frag = document.createDocumentFragment();
  render(html`<div id="engine-params" style="display:none"></div>`, frag);
  const engineParamEl = frag.firstElementChild as HTMLDivElement;
  _engineParamEl = engineParamEl;
  const firstPolyRow = polyPage.querySelector('.poly-section')!;
  firstPolyRow.parentNode!.insertBefore(engineParamEl, firstPolyRow.nextSibling);

  populateEngineSelect(deps, initialEngineId);

  deps.engineSel.addEventListener('change', () => {
    const run = () => {
      if (deps.onEngineChange) deps.onEngineChange(deps.getActiveLaneId(), deps.engineSel.value);
      else rebuildEngineParamUI();
    };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  });
}
