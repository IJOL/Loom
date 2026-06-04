import { randomizeBassParams } from './random';
import type { TB303 } from './synth';
import type { DrumMachine } from './drums';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { markPagePresetCustom, recordPagePresetForLane } from '../polysynth/polysynth-presets';
import { getDrumKits } from '../presets/drum-kits-loader';

// ── Per-lane "🎲 Sound" randomize ─────────────────────────────────────────
// Randomizes the engine's *sound* (params / kit). Note randomization is per
// Session clip and lives in the clip inspector (see clip-randomize.ts).

export interface RandomizeUIDeps {
  // Phase G: synth/drums resolved lazily — null before boot lane is allocated.
  getSynth: () => TB303 | null;
  getDrums: () => DrumMachine | null;
  /** Active bass lane id (for marking its preset select as custom). */
  getBassLaneId: () => string;
  /** Active drums lane id (for marking its preset select as custom). */
  getDrumsLaneId: () => string;
  refreshKnobsFromSynth: () => void;
  /** Apply a unified drum-kit preset by name (session-host.applyDrumPreset). */
  applyDrumKitPreset?: (laneId: string, name: string) => void;
  /** Re-reads the per-voice rack knob handles after a kit change (set in main.ts). */
  refreshDrumsRack?: () => void;
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
