// What the two preset dropdowns share: the deps handed in at boot, which preset
// each lane has selected, and which lane each select is currently showing.
//
// It lives apart from both selects because both write it — the instrument page's
// select and the drums page's — and neither should have to import the other to
// do so.

import type { SynthEngine } from '../engines/engine-types';
import type { SessionState } from '../session/session';
import type { HistoryDeps } from '../save/history-wiring';

export interface PresetControlsDeps {
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

let _deps: PresetControlsDeps | null = null;

export function setPresetControlsDeps(deps: PresetControlsDeps): void { _deps = deps; }
export function presetControlsDeps(): PresetControlsDeps | null { return _deps; }

/** Which preset each lane has selected, in the dropdown's own option
 *  vocabulary (`engine:<name>`, `user:<name>`, `sampler:…`). Read when a select
 *  is repopulated so a lane comes back showing what it is playing. */
export const pagePresetName = new Map<string, string>();

/** Mutable active-lane holder per select element id. Shared between populate
 *  (writes) and the change listener (reads) so the listener always targets the
 *  lane that is currently displayed, even when two different lanes of the same
 *  engine type share the same static select element. */
export const pageSelectActiveLane = new Map<string, { laneId: string }>();

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
  // #instrument-preset-select never registers a holder in pageSelectActiveLane
  // (it is populated per-lane by populateInstrumentPresetSelectForLane), so it
  // is synced explicitly when the lane it shows is the active one.
  if (_deps?.getActiveEngineLaneId() === laneId) setCustom('instrument-preset-select');
}

/** Record a lane's preset selection so the dropdown reflects it after a
 *  session/demo load — applying a preset moves the sound, but nothing sets
 *  pagePresetName otherwise, so the select came up "(custom — no preset)".
 *
 *  The value is recorded VERBATIM. It already carries the canonical dropdown
 *  vocabulary — `engine:<name>` for every built-in preset, `user:<name>` for a
 *  user one, `sampler:…` for the sampler — so it always matches an option. This
 *  USED to force `engine:<name>`, which matched the drums select but NOT
 *  subtractive's `factory:` options nor the sampler's `sampler:` options, so
 *  those lanes came up blank on load (correct sound, no preset). */
export function recordPagePresetForLane(laneId: string, presetName: string): void {
  pagePresetName.set(laneId, presetName);
  for (const [selectId, holder] of pageSelectActiveLane) {
    if (holder.laneId === laneId) {
      const sel = document.getElementById(selectId) as HTMLSelectElement | null;
      if (sel) sel.value = presetName;
    }
  }
}

// `refreshEnginePresetSelectById(selectId, laneId)` used to sit here. It had no
// callers left — the TB-303's own preset dropdown was its reason to exist, and
// that page is gone — so it did not come across the split.
