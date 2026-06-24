// src/modulation/active-mods.ts
// The "current lane being triggered" global. Set by the trigger dispatch /
// live-keyboard / lane-allocator immediately before each engine.createVoice()
// call so the engine learns its laneId without extending the createVoice
// signature. The synth-mode DrumsWorkletEngine reads it (getCurrentLaneForVoice)
// to bind its LFO/ADSR modulators to the Web-Audio drum-bus AudioParams.
//
// Phase 4 cutover: the worklet melodic engines run modulation in-worklet
// (ModLite, no Web-Audio bridge), so the per-lane "active mod voices" registry
// (setActiveModVoices/recordVoiceMods/getActiveModVoice) is no longer fed by any
// engine and was removed. The lane-for-voice global stays because the drums
// engine still bridges its bus-strip modulation through Web Audio.

let currentLaneForVoice: string | null = null;

export function setCurrentLaneForVoice(laneId: string | null): void {
  currentLaneForVoice = laneId;
}

export function getCurrentLaneForVoice(): string | null {
  return currentLaneForVoice;
}
