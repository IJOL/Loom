// src/modulation/mod-ui-shared.ts
// Types and mutation helpers shared by the modulators-panel templates. They
// live apart from modulation-ui.ts so the template modules can import them
// without an import cycle back through the panel entry point.

import { withUndo, type HistoryDeps } from '../save/history-wiring';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { ModulationHost } from './types';
import type { ControlCache } from '../core/control-cache';

export interface ModulationUIDeps {
  engineId: string;
  /** Scopes the destination dropdown to this lane (+ master) and namespaces
   *  this modulator's own knob ids. */
  laneId: string;
  host: ModulationHost;
  registry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  /** Engine-level rebuild: respawns modulator voices and re-renders. */
  onChange: () => void;
  /** Push the CURRENT modulator set to the live engine WITHOUT rebuilding the
   *  panel. Called after every value tweak (depth/on-off/rate/wave/…) so the
   *  change is actually heard — the worklet only re-reads modulators when this
   *  (or onChange) fires. Without it, editing DEPTH or toggling ON/OFF mutates
   *  state and saves it but never reaches the worklet, so nothing changes. */
  onLiveEdit?: () => void;
  /** Resolves a session laneId (`bass`, `main`, `drums`, `poly1`…) to its
   *  user-facing display name, so connection labels read the same as the rest
   *  of the session. Optional — raw ids are shown if omitted. */
  lookupLaneDisplayName?: (laneId: string) => string | undefined;
  sessionState?: SessionState;
  /** When present, every modulator knob drag/wheel/dblclick is bracketed as a
   *  single undo entry. */
  historyDeps?: HistoryDeps;
  /** The one destination catalogue. The dropdown is built from
   *  `destinations.list()` grouped by lane, and the panel subscribes to
   *  structural changes so it refreshes without waiting to be reopened. */
  destinations?: DestinationRegistry;
}

export interface PanelCtx {
  deps: ModulationUIDeps;
  cache: ControlCache;
  /** Repaints the panel in place, through lit-html's patching render. This is
   *  what replaces the old refreshXxxUI() closures AND, for a registry change,
   *  what replaces rebuilding the whole panel from scratch. */
  rerender: () => void;
}

/** Pushes the current modulator set to the live engine. `deps.host` is the
 *  single source of truth and the controls have just mutated it; this is the
 *  step that makes the edit audible. Every control calls it after mutating. */
export function sync(deps: ModulationUIDeps): void {
  deps.onLiveEdit?.();
  mirrorToSession(deps);
}

/** Copy the live modulator set onto the lane, and tell the catalogue.
 *
 *  `lane.engineState.modulators` used to be written only by `getStateForSave`,
 *  which made it a snapshot of the last save — fine while nothing read it in
 *  between, and wrong the moment the destination catalogue started listing each
 *  connection's DEPTH from it. Add a routing and its depth would not be
 *  automatable until you saved; remove one and it would linger as a
 *  destination that writes nowhere.
 *
 *  Cheap enough to run per edit: serialize() is a shallow-cloned array of small
 *  objects, and this fires on a control gesture, not per frame. */
export function mirrorToSession(deps: ModulationUIDeps): void {
  const lane = deps.sessionState?.lanes.find((l) => l.id === deps.laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.modulators = deps.host.serialize();
  // The SET of destinations may have changed — a connection added or removed.
  // Every picker subscribes; none of them polls.
  deps.destinations?.invalidate();
}

/** Runs a mutation bracketed as one undo entry when history is wired. Replaces
 *  the `if (deps.historyDeps) withUndo(...) else run()` pattern that appeared
 *  at thirteen call sites. */
export function edit(deps: ModulationUIDeps, run: () => void): void {
  if (deps.historyDeps) withUndo(deps.historyDeps, run);
  else run();
}
