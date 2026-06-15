import { randomizeBassParams } from './random';
import type { TB303 } from './synth';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { markPagePresetCustom, recordPagePresetForLane } from '../polysynth/polysynth-presets';
import { getDrumKits } from '../presets/drum-kits-loader';

// ── Per-lane "🎲 Sound" randomize ─────────────────────────────────────────
// Randomizes the engine's *sound* (params / kit). Only sound parameters are
// affected here; note content in clips is not touched.

export interface RandomizeUIDeps {
  // Phase G: synth resolved lazily — null before boot lane is allocated.
  getSynth: () => TB303 | null;
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

function randomizeBassSound(deps: RandomizeUIDeps): void {
  const synth = deps.getSynth();
  if (!synth) return;
  randomizeBassParams(synth);
  deps.refreshKnobsFromSynth();
  markPagePresetCustom('bass-preset-select', deps.getBassLaneId());
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
    withUndo(deps.historyDeps, () => randomizeBassSound(deps));
  });
  $btn('drums-random-sound')?.addEventListener('click', () => {
    withUndo(deps.historyDeps, () => randomizeDrumsSound(deps));
  });
}
