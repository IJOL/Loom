// The desktop menu bar's last mile: the MenuActions table and the two calls that
// mount the bar and register its accelerators.
//
// The cohesion here is the TABLE, not the chrome. menu-actions.ts declares WHAT
// the menu can do, menu-spec.ts arranges those verbs into File/Edit/View/Tools/
// Help, menu-bar.ts renders them and menu-shortcuts.ts binds the accelerators —
// four files that all describe the menu without knowing a single thing about this
// app. This module is the one place that says which handle answers each verb, so
// it is also the one place that has to name nearly every feature in boot. That is
// why it is the LAST thing main.ts does and why it has the longest deps list in
// src/app: it does not produce anything, it only connects things that already
// exist.
//
// ORDER: keep the `wireMenuBar(...)` call as the final statement of main.ts.
// Beyond being the natural end of boot, `createMenuBar` reaching the DOM is the
// repo's only observable proof that main.ts ran start to finish — main.ts has no
// top-level try/catch, so an unguarded throw anywhere above leaves the menu bar
// empty and tests/e2e/menu-bar.spec.ts red. Anything appended after this call
// loses that protection.

import type { SessionHost } from '../session/session-host';
import type { PerformanceFeature } from './performance-feature';
import type { PerfDiagnostics } from '../perf/perf-diagnostics';
import type { AutoHistory } from '../save/auto-history';
import type { DemoItem, MenuActions } from './menu-actions';
import { loadDemoSession } from '../demo/demo-picker';
import { createMenuBar } from './menu-bar';
import { buildMenus } from './menu-spec';
import { registerMenuShortcuts } from './menu-shortcuts';

export interface MenuBarWiringDeps {
  /** Capture Scene, and the host every demo load applies its state into. */
  sessionHost: SessionHost;
  /** Save/Load — the SAME dialog the toolbar buttons open, never a synthetic click. */
  saveManager: { openForSave(): void; openForLoad(): void };
  projectOptions: { open(): void };
  /** Undo/redo AND their enablement, so the menu can grey the items out. */
  autoHistory: AutoHistory;
  /** Session/Performance mode + "copy scenes to the timeline". */
  performanceFeature: PerformanceFeature;
  /** The PERF HUD; the menu item reflects `isOpen()`. */
  perfDiagnostics: PerfDiagnostics;
  midiImportDialog: { open(): void };
  midiControlDialog: { open(): void };
  stemDialog: { open(): void };
  aboutDialog: { open(): void };
  /** The one demo list, shared with the toolbar picker (src/app/session-lifecycle.ts). */
  demos: DemoItem[];
  /** The same wipe the toolbar's New button runs — the function, not a click. */
  newSession(): Promise<void>;
  /** A demo may carry its own tempo; it has to reach the scheduler, the BPM
   *  input, every insert chain and every tempo-locked engine. */
  setTransportBpm(bpm: number): void;
}

export function wireMenuBar(deps: MenuBarWiringDeps): void {
  const {
    sessionHost, saveManager, projectOptions, autoHistory, performanceFeature,
    perfDiagnostics, midiImportDialog, midiControlDialog, stemDialog, aboutDialog,
    demos: DEMOS, newSession, setTransportBpm,
  } = deps;

  // ── Desktop menu bar (chrome) ──────────────────────────────────────────────
  // MenuActions is a plain object literal of ARROW FUNCTIONS (never bare method
  // references / `this`-bound class methods): menu-spec.ts pulls some fields out
  // as bare references (e.g. `run: a.undo`), so the underlying functions must be
  // `this`-free closures for that to keep working correctly.
  const menuActions: MenuActions = {
    newSession: () => { void newSession(); },
    openSaveForSave: () => saveManager.openForSave(),
    openSaveForLoad: () => saveManager.openForLoad(),
    openProjectOptions: () => projectOptions.open(),
    listDemos: () => DEMOS,
    loadDemo: (path) => { void loadDemoSession(path, { sessionHost, applyBpm: setTransportBpm, onLoaded: () => autoHistory.markClean() }); },
    openImportMidi: () => midiImportDialog.open(),
    openStems: () => stemDialog.open(),
    undo: () => autoHistory.undo(),
    redo: () => autoHistory.redo(),
    canUndo: () => autoHistory.canUndo(),
    canRedo: () => autoHistory.canRedo(),
    setMode: (m) => performanceFeature.setMode(m),
    getMode: () => performanceFeature.getMode(),
    togglePerfDiagnostics: () => perfDiagnostics.toggle(),
    isPerfOpen: () => perfDiagnostics.isOpen(),
    openMidiController: () => midiControlDialog.open(),
    captureScene: () => sessionHost.captureScene(),
    copyScenesToPerformance: () => performanceFeature.copyFromSession(),
    openManual: () => { window.open('manual/', '_blank', 'noopener'); },
    openAbout: () => aboutDialog.open(),
  };
  createMenuBar(document.getElementById('menu-bar')!, buildMenus(menuActions));
  registerMenuShortcuts(menuActions);
}
