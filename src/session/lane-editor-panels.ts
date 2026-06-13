// src/session/lane-editor-panels.ts
// Which panels a lane's editor renders. An 'audio' lane is NOT an instrument:
// no engine-params/preset/NOTE-FX/engine-selector — only its insert FX. drums
// keep everything except NOTE FX (drums aren't note-transformed). Pure so the
// lane-editor wiring is testable.

export interface LaneEditorPanels {
  engineParams: boolean;    // the engine's knob UI (e.g. the audio Gain) in the lane editor
  noteFx: boolean;          // the per-lane NOTE FX (arp/chord) panel
  preset: boolean;          // the preset dropdown
  inserts: boolean;         // the per-lane insert FX chain
  engineHeaderRow: boolean; // the poly page's ENGINE/PRESET/🎲 header row
}

export function laneEditorPanels(engineId: string): LaneEditorPanels {
  const isAudio = engineId === 'audio';
  return {
    engineParams: !isAudio,
    noteFx: !isAudio && engineId !== 'drums-machine',
    preset: !isAudio,
    inserts: true,
    engineHeaderRow: !isAudio,
  };
}
