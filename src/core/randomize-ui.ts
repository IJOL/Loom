import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { markPagePresetCustom, recordPagePresetForLane } from '../polysynth/polysynth-presets';
import { getDrumKits } from '../presets/drum-kits-loader';
import { commitEngineBaseValues } from '../engines/engine-param-commit';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionState } from '../session/session';

// ── Per-lane "🎲 Sound" randomize ─────────────────────────────────────────
// Randomizes the engine's *sound* (params / kit). Only sound parameters are
// affected here; note content in clips is not touched.
//
// The melodic side asks the ENGINE to roll its own params (engine.randomize(),
// generic over the declared spec — see engines/engine-randomize.ts). It used to
// reach for the node-per-note TB303 class through a `getInstance()` no engine
// implements, so the button had been silently dead since the worklet cutover:
// randomizeBassSound returned at its `if (!synth)` guard on every click.

export interface RandomizeUIDeps {
  /** The live engine of a lane, or null before it is allocated. */
  getEngine: (laneId: string) => SynthEngine | null;
  /** Live session, so a rolled sound is mirrored into the lane and survives a save. */
  getSessionState?: () => SessionState | undefined;
  /** Active bass lane id (for marking its preset select as custom). */
  getBassLaneId: () => string;
  /** Active drums lane id (for marking its preset select as custom). */
  getDrumsLaneId: () => string;
  refreshKnobsFromSynth: () => void;
  /** Apply a unified drum-kit preset by name (session-host.applyDrumPreset).
   *  The orchestrator handles the rack/panel rebuild, so the drums path no
   *  longer needs getDrums()/refreshDrumsRack(). */
  applyDrumKitPreset?: (laneId: string, name: string) => void;
  historyDeps: HistoryDeps;
}

function randomizeMelodicSound(deps: RandomizeUIDeps, laneId: string, presetSelectId: string): void {
  const engine = deps.getEngine(laneId);
  if (!engine?.randomize) return;
  engine.randomize();
  // The engine writes through setBaseValue, so no knob onChange fires and
  // commitParam never runs: mirror the whole bag or the rolled sound is lost on
  // save (the bulk sibling exists for exactly this — presets, Randomize).
  commitEngineBaseValues(engine, deps.getSessionState?.(), laneId);
  deps.refreshKnobsFromSynth();
  markPagePresetCustom(presetSelectId, laneId);
}

/** Pick a random unified drum-kit name (synth or sample). Null if none loaded. */
export function pickRandomDrumKit(rng: () => number = Math.random): string | null {
  const kits = getDrumKits();
  if (kits.length === 0) return null;
  return kits[Math.floor(rng() * kits.length)].name;
}

function randomizeDrumsSound(deps: RandomizeUIDeps): void {
  const name = pickRandomDrumKit();
  if (!name) return;
  const laneId = deps.getDrumsLaneId();
  deps.applyDrumKitPreset?.(laneId, name);
  // Sync the drums preset dropdown to the picked kit (the orchestrator only
  // updates lane state + the inspector body, not the <select> selection).
  recordPagePresetForLane(laneId, `engine:${name}`);
}

/** Wire the "🎲 Sound" buttons. Call once at boot. */
export function wireRandomizeUI(deps: RandomizeUIDeps): void {
  const $btn = (id: string) => document.getElementById(id) as HTMLButtonElement | null;

  $btn('bass-random-sound')?.addEventListener('click', () => {
    withUndo(deps.historyDeps, () => {
      randomizeMelodicSound(deps, deps.getBassLaneId(), 'bass-preset-select');
    });
  });
  $btn('drums-random-sound')?.addEventListener('click', () => {
    withUndo(deps.historyDeps, () => randomizeDrumsSound(deps));
  });
}
