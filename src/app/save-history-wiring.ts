// The persistence + undo spine, in one place: the snapshot/restore pair that
// both the Save Manager and undo are built on, the history stack they share,
// AutoHistory with its document-level listeners / keyboard / undo buttons, and
// the two seams the rest of the app reaches undo through (the gesture bracket
// and the async checkpoint).
//
// It is one module because it is one object graph, built in an order that is
// load-bearing from the first line to the last: `history` feeds both saveBaseDeps
// and historyDeps; `savedStateDeps` IS `saveBaseDeps` (same object, deliberately
// not a copy) so the undo snapshot reads exactly what the Save Manager writes;
// historyDeps and autoHistory are built from the SAME snapshot/restore pair;
// the gesture brackets are attached to historyDeps AFTER autoHistory exists; and
// only then is historyDeps handed to the session inspector, which must receive it
// with those brackets already on it. Splitting any of that apart would mean
// inventing a protocol rather than moving code.
//
// Deliberately NOT moved with it, and still sequenced by main.ts: assigning
// `_discreteHistoryDeps` (the late-binding seam eight closures in main read),
// wireRandomizeUI, wireSaveManager and bootRecoveryLoad. Those are "run this
// now, at this point" — which is what main.ts is for.
//
// The Performance take arrives as a thunk rather than a value: save/load
// persists the take + mode through the feature's accessors, but this module
// neither owns the feature nor decides when it exists.

import type { Sequencer } from '../core/sequencer';
import type { FxBus, MasterCompressor } from '../core/fx';
import type { MasterBusStrip } from '../core/master-bus-strip';
import type { MasterShaper } from '../core/master-shaper';
import type { InsertChain } from '../plugins/fx/insert-chain';
import type { SessionHost } from '../session/session-host';
import type { LaneAllocator } from './lane-allocator';
import type { PerformanceFeature } from './performance-feature';
import { createHistory } from '../core/history';
import { createAutoHistory, type AutoHistory } from '../save/auto-history';
import { wireHistoryKeyboard, type HistoryDeps } from '../save/history-wiring';
import { wireUndoButtons } from '../save/undo-buttons';
import {
  buildSavedStateV3, applyLoadedStateV3, type SavedStateV3, type SavedStateV3Deps,
} from '../save/saved-state-v3';
import type { SaveWiringDeps } from '../save/save-wiring';

export interface SaveAndHistoryDeps {
  ctx: AudioContext;
  seq: Sequencer;
  lanes: LaneAllocator;
  master: GainNode;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  meterSel: HTMLSelectElement;
  sessionHost: SessionHost;
  renderLanes: () => void;
  fx: FxBus;
  masterInsertChain: InsertChain;
  masterStrip: MasterBusStrip;
  masterComp: MasterCompressor;
  masterShaper: MasterShaper;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
  /** Late-bound: the Performance feature is built earlier in boot, but the take
   *  accessors must read it at save/load time, not at construction. */
  getPerformanceFeature: () => PerformanceFeature;
  /** Master-strip repaints after an undo/redo restore — the compressor and the
   *  shaper cache their state in their own panels. */
  refreshMasterComp: () => void;
  refreshMasterShaper: () => void;
}

export interface SaveAndHistory {
  /** The single source of truth for undo/redo. */
  autoHistory: AutoHistory;
  /** The manual undo seam (withUndo / attachKnobUndo). main.ts publishes it to
   *  the discrete selectors via `_discreteHistoryDeps` and hands it to
   *  wireRandomizeUI. */
  historyDeps: HistoryDeps;
  /** What wireSaveManager and bootRecoveryLoad both take. */
  saveWiringDeps: SaveWiringDeps;
}

export function createSaveAndHistory(deps: SaveAndHistoryDeps): SaveAndHistory {
  const {
    ctx, seq, lanes, master,
    volInput, bpmInput, swingInput, meterSel,
    sessionHost,
    renderLanes,
    fx,
    masterInsertChain,
    masterStrip,
    masterComp,
    masterShaper,
    flashButton,
    getPerformanceFeature,
    refreshMasterComp,
    refreshMasterShaper,
  } = deps;

  const history = createHistory<SavedStateV3>({ maxSize: 100 });
  // Phase G: synth/drums replaced by lanes (resolved lazily inside buildSavedStateV3).
  const saveBaseDeps = {
    ctx, seq, lanes, master,
    volInput, bpmInput, swingInput, meterSel,
    sessionHost,
    renderLanes,
    fx,
    masterInsertChain,
    masterStrip,
    masterComp,
    masterShaper,
    flashButton,
    history,
  };
  // Save/load persists the Performance take + mode via the feature accessors.
  const saveWiringDeps: SaveWiringDeps = {
    ...saveBaseDeps,
    getMode: () => getPerformanceFeature().getMode(),
    getArrangement: () => getPerformanceFeature().arrangement,
    setMode: (m) => getPerformanceFeature().setMode(m),
    setArrangement: (a) => getPerformanceFeature().setArrangement(a),
    onAfterApply: () => autoHistory.markClean(),
  };
  // History (undo/redo) snapshots session state only — no perf accessors, so a
  // recorded take is never wiped by undoing an unrelated session edit.
  const savedStateDeps: SavedStateV3Deps = saveBaseDeps;
  const historyDeps: HistoryDeps = {
    history,
    snapshot: () => buildSavedStateV3(savedStateDeps),
    restore: (s) => applyLoadedStateV3(s, savedStateDeps),
  };
  const autoHistory = createAutoHistory({
    history,
    snapshot: () => buildSavedStateV3(savedStateDeps),
    restore: (s) => applyLoadedStateV3(s, savedStateDeps),
    refreshAll: () => { sessionHost.refreshAfterRestore(); refreshMasterComp(); refreshMasterShaper(); },
  });
  autoHistory.installGlobalListeners(document);
  wireHistoryKeyboard(autoHistory);
  wireUndoButtons(autoHistory);
  // Route gesture brackets through AutoHistory's gestureDepth so pointer-capture
  // drags (piano-roll, drum-grid, knobs, faders) coalesce into one undo step.
  historyDeps.beginGesture = () => autoHistory.beginGesture();
  historyDeps.endGesture   = () => autoHistory.endGesture();
  // Wire async-mutation checkpoint: stems / transcription / import flows call this
  // after their async settle (no pointer/key event closes the event loop there).
  sessionHost.deps.checkpointHistory = () => autoHistory.checkpoint();
  // Wire historyDeps into the session inspector so drum-grid cell clicks are
  // undoable. Must happen after historyDeps is built (it closes over sessionHost
  // via savedStateDeps → saveWiringDeps).
  sessionHost.setHistoryDeps(historyDeps);

  return { autoHistory, historyDeps, saveWiringDeps };
}
