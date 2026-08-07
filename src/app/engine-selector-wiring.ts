// The engine selector, and the deps bundles that hang off it.
//
// The cohesion is "which engine is the user editing, and what has to be re-mounted
// when that answer changes". Two things answer it together:
//
//  1. The selector (#engine-select on the poly page) swaps the active lane's
//     engine and, through rebuildEngineParamUI, decides which param UI is on
//     screen. It is the owner of the remount hooks. There used to be a SECOND
//     one (#engine-select-303) doing the same swap from the TB-303's own page,
//     differing only in which lane it meant; that page is gone and so is it.
//  2. The poly/preset deps and the synth-editor routing deps are the other half
//     of the same remount: when the editor re-points at a lane, the per-lane FX
//     panel has to be re-mounted UNDER THAT LANE'S ID or its knobs come up
//     unregistered. That is the same failure the selector's remountLaneFxPanel
//     hook exists to prevent, so the two hooks belong in one place where they
//     cannot drift apart.
//
// ORDER, and what deliberately stayed in main.ts:
//
//  * `wireInstrumentPresetControls(instrumentPresetDeps)` is NOT called here. It runs ~230
//    lines later in boot, and moving the preset-dropdown binding that far
//    earlier is a real reordering. This factory only BUILDS the deps and hands
//    them back; main keeps the call exactly where it was.
//  * `synthEditorDeps` is likewise returned, not installed: main holds it in a
//    `let` that showPolyEditorWrapper reads lazily (and bails on when null), so
//    the assignment has to happen at main's scope, at this same point in boot.
//  * The master-FX block that used to sit right below (wireFxUI + its three
//    onStateApplied registrations) stayed behind: its deps object is nearly as
//    long as the code, and refreshMasterComp/refreshMasterShaper are read by the
//    save/history wiring further down.
//
// Everything late-bound is handed in as a thunk, never as a value:
// `getHistoryDeps` (main's _discreteHistoryDeps is assigned near the END of boot)
// and `populateAutoParamSelect` (a `let` wrapper populated at boot). Capturing
// either by value here would compile and would silently stop the selector's
// changes from being undoable.

import type { KnobHandle } from '../core/knob';
import type { LaneResourceMap } from '../core/lane-resources';
import type { HistoryDeps } from '../save/history-wiring';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionHost } from '../session/session-host';
import {
  wireEngineSelector, rebuildEngineParamUI,
  type EngineSelectorUIDeps,
} from '../engines/engine-selector-ui';
import { swapLaneEngineFlow, type EngineSwapDeps } from './engine-swap';
import { refreshInstrumentPresetSelect } from '../instrument-presets/instrument-preset-select';
import type { PresetControlsDeps } from '../instrument-presets/preset-select-state';

export interface EngineSelectorWiringDeps {
  engineSel: HTMLSelectElement;
  /** Engine id the generic selector is seeded with at boot ('subtractive'). */
  initialEngineId: string;
  /** The lane painted on the INSTRUMENT page (laneHost.state.instrumentPageLaneId).
   *  Deliberately NOT sessionHost.activeEditLane, and the rule is not arbitrary:
   *  selecting a drum lane shows the drums page, so the instrument page — and
   *  therefore this selector, its preset dropdown and its FX panel — stays on
   *  the last melodic lane. See LaneEngineHostState for what breaks otherwise. */
  getActiveEngineLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  automationRegistry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  /** Late-bound: main's populateAutoParamSelectWrapper is a `let` populated at
   *  boot, so this must be a thunk read at event-fire time. */
  populateAutoParamSelect: () => void;
  mountLaneFxPanel: (laneId: string) => void;
  /** Late-bound: _discreteHistoryDeps is assigned after historyDeps is built,
   *  which is much further down boot. Read at event-fire time, never captured. */
  getHistoryDeps: () => HistoryDeps | undefined;
  /** The swap flow's own deps bundle, built in main next to the engine registry. */
  engineSwapDeps: EngineSwapDeps;
  /** The undo-wrapped swap the 303 page uses (main wraps swapLaneEngineFlow). */
  onEngineChangeUndoable: (laneId: string, newEngineId: string) => void;
  /** Read for activeEditLane (303 selector), state (preset persistence) and
   *  applyDrumPreset (the ctx-aware drum-kit orchestrator). */
  sessionHost: SessionHost;
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  refreshLaneKnobs: (laneId: string, engine: SynthEngine) => void;
  /** Read to decide whether the editor's lane is a subtractive one. */
  laneResources: LaneResourceMap;
  setActiveEngineLane: (laneId: string) => void;
}

export interface EngineSelectorWiring {
  /** Built here, CALLED by main (`wireInstrumentPresetControls`) ~230 lines later in boot —
   *  see the ORDER note in the header. */
  instrumentPresetDeps: PresetControlsDeps;
}

export function wireEngineSelectors(deps: EngineSelectorWiringDeps): EngineSelectorWiring {
  const {
    engineSel, initialEngineId, getActiveEngineLaneId, getLaneEngineId,
    automationRegistry, registerKnob, populateAutoParamSelect,
    mountLaneFxPanel, getHistoryDeps,
    engineSwapDeps, onEngineChangeUndoable, sessionHost,
    getLaneEngineInstance, refreshLaneKnobs, laneResources, setActiveEngineLane,
  } = deps;

  // Engine selector UI (must come after populateAutoParamSelectWrapper is set)
  const engineSelectorDeps: EngineSelectorUIDeps = {
    engineSel,
    getActiveLaneId: () => getActiveEngineLaneId(),
    getLaneEngineId,
    automationRegistry,
    registerKnob,
    populateAutoParamSelect: () => populateAutoParamSelect(),
    remountLaneFxPanel: (laneId) => mountLaneFxPanel(laneId),
    // Late-bound via getter: _discreteHistoryDeps is assigned after historyDeps
    // is built (further below), but the change handler fires at user-interaction
    // time, so the getter always sees the final value.
    get historyDeps() { return getHistoryDeps(); },
    // Raw flow here — the poly selector's change handler already wraps in withUndo
    // via historyDeps above.
    onEngineChange: (laneId, newId) => { swapLaneEngineFlow(engineSwapDeps, laneId, newId); },
  };
  wireEngineSelector(engineSelectorDeps, initialEngineId);

  const instrumentPresetDeps: PresetControlsDeps = {
    getActiveEngineLaneId: () => getActiveEngineLaneId(),
    getLaneEngineId,
    getLaneEngineInstance,
    getSessionState: () => sessionHost.state,
    refreshLaneKnobs: (laneId) => {
      const inst = getLaneEngineInstance(laneId);
      if (inst) refreshLaneKnobs(laneId, inst);
    },
    // Late-bound via getter so historyDeps is resolved at event-fire time.
    get historyDeps() { return getHistoryDeps(); },
    applyDrumKitPreset: (laneId, name) => { void sessionHost.applyDrumPreset(laneId, name); },
  };

  // The `synthEditorDeps` bundle that used to be built here is gone with the
  // PolySynth purge: its only consumer was showPolyEditor(), reached exclusively
  // through a `getPolySynth()` branch no engine could satisfy. Every engine's
  // knobs, Subtractive included, are drawn by buildParamUI from the engine's
  // declared params — there is no separate remount path for it any more.
  return { instrumentPresetDeps };
}
