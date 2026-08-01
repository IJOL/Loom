// src/session/lane-editor-panels.ts
// Which panels a lane's editor renders. An 'audio' lane is NOT an instrument:
// no engine-params/preset/NOTE-FX/engine-selector — only its insert FX. drums
// keep everything except NOTE FX (drums aren't note-transformed). Pure so the
// lane-editor wiring is testable.

import { isAudioEngine, acceptsNoteFx, isRandomizable } from '../plugins/capabilities';

export interface LaneEditorPanels {
  engineParams: boolean;    // the engine's knob UI (e.g. the audio Gain) in the lane editor
  noteFx: boolean;          // the per-lane NOTE FX (arp/chord) panel
  preset: boolean;          // the preset dropdown
  inserts: boolean;         // the per-lane insert FX chain
  engineHeaderRow: boolean; // the header row that holds ENGINE / PRESET / 🎲
  dice: boolean;            // the "🎲 Sound" button inside that row
}

export function laneEditorPanels(engineId: string): LaneEditorPanels {
  // An engine whose clips ARE audio files is not an instrument: no engine knobs,
  // no preset, no selector. Only its inserts.
  const isAudio = isAudioEngine(engineId);
  return {
    engineParams: !isAudio,
    noteFx: !isAudio && acceptsNoteFx(engineId),
    preset: !isAudio,
    inserts: true,
    engineHeaderRow: !isAudio,
    // The dice rolls the engine's DECLARED params, so an engine whose sound is a
    // loaded thing — the sampler's keymap, the drum machine's kit — has nothing
    // to roll and says so. It shows no dice at all rather than a dead one.
    dice: !isAudio && isRandomizable(engineId),
  };
}
