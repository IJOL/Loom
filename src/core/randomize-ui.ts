import { randomizeBassParams } from './random';
import type { TB303 } from './synth';
import type { DrumMachine } from './drums';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { markPagePresetCustom } from '../polysynth/polysynth-presets';

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

function randomizeDrumsSound(deps: RandomizeUIDeps): void {
  const drums = deps.getDrums();
  if (!drums) return;
  const kits = drums.listKits();
  if (kits.length === 0) return;
  const pick = kits[Math.floor(Math.random() * kits.length)];
  drums.loadKitDefaults(pick.id);
  markPagePresetCustom('drums-preset-select', deps.getDrumsLaneId());
  deps.refreshDrumsRack?.();
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
