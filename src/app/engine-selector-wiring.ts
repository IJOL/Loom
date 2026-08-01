// The two engine selectors, and the two deps bundles that hang off them.
//
// The cohesion is "which engine is the user editing, and what has to be re-mounted
// when that answer changes". Three things answer it together:
//
//  1. The GENERIC selector (#engine-select on the poly page) swaps the active
//     lane's engine and, through rebuildEngineParamUI, decides which param UI is
//     on screen. It is the owner of the remount hooks.
//  2. The 303 PAGE selector (#engine-select-303) is the same swap from the other
//     page, differing only in which lane it means (sessionHost.activeEditLane
//     rather than the engine host's active lane) and in already being undoable.
//  3. The poly/preset deps and the synth-editor routing deps are the other half
//     of the same remount: when the editor re-points at a lane, the subtractive
//     section knobs have to be re-mounted UNDER THAT LANE'S ID or the LFO/ADSR
//     destination dropdown comes up empty. That is the same failure the
//     selector's remountSubtractiveLaneKnobs hook exists to prevent, so the two
//     hooks belong in one place where they cannot drift apart.
//
// ORDER, and what deliberately stayed in main.ts:
//
//  * `wirePolyControls(polySynthPresetsDeps)` is NOT called here. It runs ~230
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
  wireEngineSelector, wireEngineSelector303, rebuildEngineParamUI,
  type EngineSelectorUIDeps,
} from '../engines/engine-selector-ui';
import { swapLaneEngineFlow, type EngineSwapDeps } from './engine-swap';
import { refreshPolyPresetSelect, type PolySynthPresetsDeps } from '../polysynth/polysynth-presets';

export interface EngineSelectorWiringDeps {
  engineSel: HTMLSelectElement;
  engineSel303: HTMLSelectElement;
  /** Engine id the generic selector is seeded with at boot ('subtractive'). */
  initialEngineId: string;
  /** The lane the ENGINE HOST considers active (laneHost.state.activeLaneId).
   *  Deliberately not the same lane as sessionHost.activeEditLane, which is what
   *  the 303 page's selector means — keeping both is the existing behaviour. */
  getActiveEngineLaneId: () => string;
  getLaneEngineId: (laneId: string) => string;
  automationRegistry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  /** Late-bound: main's populateAutoParamSelectWrapper is a `let` populated at
   *  boot, so this must be a thunk read at event-fire time. */
  populateAutoParamSelect: () => void;
  mountSubtractiveLaneKnobs: (laneId: string) => void;
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
  /** Built here, CALLED by main (`wirePolyControls`) ~230 lines later in boot —
   *  see the ORDER note in the header. */
  polySynthPresetsDeps: PolySynthPresetsDeps;
}

export function wireEngineSelectors(deps: EngineSelectorWiringDeps): EngineSelectorWiring {
  const {
    engineSel, engineSel303, initialEngineId, getActiveEngineLaneId, getLaneEngineId,
    automationRegistry, registerKnob, populateAutoParamSelect,
    mountSubtractiveLaneKnobs, mountLaneFxPanel, getHistoryDeps,
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
    remountSubtractiveLaneKnobs: (laneId) => mountSubtractiveLaneKnobs(laneId),
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

  wireEngineSelector303({
    engineSel303,
    getActiveLaneId: () => sessionHost.activeEditLane,
    onEngineChange: onEngineChangeUndoable,
  });

  const polySynthPresetsDeps: PolySynthPresetsDeps = {
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
  // through a `getPolySynth()` branch no engine could satisfy. Subtractive knobs
  // are re-mounted through the live path instead — engine-selector-ui calls
  // remountSubtractiveLaneKnobs when the lane's engine changes.
  return { polySynthPresetsDeps };
}
