import { html, render } from 'lit-html';
import { getEngineDescriptor, listEngines } from './registry';
import { populatePolyPresetSelect, refreshPolyPresetSelect } from '../instrument-presets/polysynth-presets';
import type { KnobHandle } from '../core/knob';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { isAudioEngine } from '../plugins/capabilities';

export interface EngineSelectorUIDeps {
  engineSel: HTMLSelectElement;
  getActiveLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  automationRegistry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  populateAutoParamSelect: () => void;
  /** Called UNCONDITIONALLY by `rebuildEngineParamUI` (for every engine) so
   *  the per-lane FX panel's knobs (which sit at `<laneId>.fx.*`) get
   *  re-registered across engine switches. The hook also re-paints the FX
   *  panel DOM. */
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
 *  The source list is the ENGINE registry, not listPlugins('engine'). Those are
 *  two different registries: listPlugins holds what the build-time
 *  `import.meta.glob` over src/ found, so a RUNTIME plugin — which registers its
 *  engine through the host's adoptComponents and never appears in that glob — could
 *  never show up in the selector while this read from there. That is not a
 *  cosmetic difference: it is the whole "a plugin is a first-class engine"
 *  claim, and it was broken for every plugin engine. */
export function melodicSynthEngineIds(): string[] {
  return listEngines('polyhost')
    .map((e) => e.id)
    .filter((id) => !isAudioEngine(id) && getEngineDescriptor(id)?.editor === 'piano-roll');
}

let _deps: EngineSelectorUIDeps | null = null;
let _engineParamEl: HTMLDivElement | null = null;

export function rebuildEngineParamUI(): void {
  const deps = _deps!;
  const engineParamEl = _engineParamEl!;

  engineParamEl.innerHTML = '';
  const activeLaneId = deps.getActiveLaneId();

  // Re-mount the per-lane FX panel unconditionally so its knobs (laneId.fx.*)
  // stay in the registry across a rebuild, regardless of engine. There used
  // to be an `unregisterKnobsByPrefix('<activeLaneId>.')` call right here, to
  // drop stale knobs before remounting — but it deleted every registry entry
  // under the lane's id, mixer strip included (`<laneId>.bus.*`), which is
  // mounted in the mixer column, not here. It only "worked" because
  // showLaneEditor (session-host-lane-editor.ts) always calls
  // renderWithMixer() right after this, which re-registers the mixer knobs.
  // Ownership-scoped unmount is `injectEngineModulatorPanel`'s job now (see
  // `idsOwnedByHost` there) — this function no longer needs to clear anything
  // itself.
  deps.remountLaneFxPanel?.(activeLaneId);
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

/** Rebuild a melodic-engine `<select>` from the registry AS IT IS NOW.
 *
 *  Boot paints these selects synchronously, long before `loadPlugins()` resolves,
 *  so an engine that arrives as a runtime plugin is simply not in the list yet —
 *  and nothing repaints it. Without this call the whole drop-in promise fails at
 *  the last inch: the plugin loads, registers, synthesises, and the user still
 *  cannot pick it. Caller: main.ts, off `pluginsReady`. */
export function refreshMelodicEngineOptions(sel: HTMLSelectElement, currentEngineId: string): void {
  renderMelodicOptions(sel, currentEngineId);
}

// There is no second engine selector. `wireEngineSelector303` lived here and did
// the same swap as the generic one, differing only in which lane it meant —
// because the TB-303 had a page of its own. That page is gone, so the bass lane
// is swapped by `#engine-select` like every other melodic lane.

export function wireEngineSelector(deps: EngineSelectorUIDeps, initialEngineId: string): void {
  _deps = deps;

  // Build the engine-params container and insert it into the poly page.
  // One-shot scaffolding: rendered into a fragment, the element pulled out.
  const polyPage = document.querySelector('[data-page="instrument"]')!;
  const frag = document.createDocumentFragment();
  render(html`<div id="engine-params" style="display:none"></div>`, frag);
  const engineParamEl = frag.firstElementChild as HTMLDivElement;
  _engineParamEl = engineParamEl;
  const firstPolyRow = polyPage.querySelector('.instrument-section')!;
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
