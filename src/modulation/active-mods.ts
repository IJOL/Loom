// src/modulation/active-mods.ts
// Tracks the most-recently-spawned modulator voices per lane, so the rAF
// knob animation loop can poll `currentValue()` and drive the amber ring
// overlay on destination knobs.
//
// Engines call `setActiveModVoices(laneId, voiceMods)` from inside their
// `createVoice` path. They learn the laneId via the module-level
// `currentLaneForVoice` set by main.ts immediately before each
// `engine.createVoice(...)` call. This is an ugly-but-contained global so
// engines don't need their `createVoice` signature extended.

import type { ModulatorVoice } from './types';

let currentLaneForVoice: string | null = null;

export function setCurrentLaneForVoice(laneId: string | null): void {
  currentLaneForVoice = laneId;
}

export function getCurrentLaneForVoice(): string | null {
  return currentLaneForVoice;
}

const active = new Map<string, Map<string, ModulatorVoice>>();

export function setActiveModVoices(
  laneId: string,
  voiceMods: Map<string, ModulatorVoice>,
): void {
  active.set(laneId, voiceMods);
}

export function getActiveModVoice(
  laneId: string,
  modId: string,
): ModulatorVoice | undefined {
  return active.get(laneId)?.get(modId);
}

/** Convenience used inside engines' createVoice — pulls the lane currently
 *  being created from the module global and records the voice mods. No-op
 *  if no lane is set (e.g. legacy direct createVoice calls). */
export function recordVoiceMods(voiceMods: Map<string, ModulatorVoice>): void {
  const lane = currentLaneForVoice;
  if (!lane) return;
  setActiveModVoices(lane, voiceMods);
}
