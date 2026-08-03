// src/session/lane-editor-panels.ts
// Which panels a lane's editor renders. An 'audio' lane is NOT an instrument:
// no engine-params/preset/NOTE-FX/engine-selector — only its insert FX. drums
// keep everything except NOTE FX (drums aren't note-transformed). Pure so the
// lane-editor wiring is testable.

import { isAudioEngine, acceptsNoteFx, isRandomizable } from '../plugins/capabilities';
import { getEngine } from '../engines/registry';

export interface LaneEditorPanels {
  engineParams: boolean;    // the engine's knob UI (e.g. the audio Gain) in the lane editor
  noteFx: boolean;          // the per-lane NOTE FX (arp/chord) panel
  preset: boolean;          // the preset dropdown
  inserts: boolean;         // the per-lane insert FX chain
  engineHeaderRow: boolean; // the header row that holds ENGINE / PRESET / 🎲
  dice: boolean;            // the "🎲 Sound" button inside that row
  /** No plugin registered this engine. The lane keeps its strip and its inserts
   *  and says so, instead of drawing an instrument that cannot sound.
   *  The discriminator is the DESCRIPTOR, not the capabilities: an unknown id
   *  answers every capability like an ordinary melodic engine on purpose, so
   *  capabilities cannot tell "absent" from "present and plain". */
  missingEngine: boolean;
}

export function laneEditorPanels(engineId: string): LaneEditorPanels {
  // Nobody registered this engine — a deleted plugin folder, or a session saved
  // on a machine that had it. Every panel below reads a descriptor that does not
  // exist, so they all go; the inserts stay, because the chain is the HOST's,
  // not the engine's, and the lane's saved slots must survive the round trip.
  //
  // `getEngine`, not `getEngineDescriptor`: both answer from the same map and
  // are undefined for exactly the same ids, but building a descriptor
  // serialises the engine's modulator host — which is lazy, and throws if the
  // lfo/adsr components have not registered yet. This function decides what to
  // DRAW; it must not be able to throw for the engine that is present.
  if (getEngine(engineId) === undefined) {
    return {
      engineParams: false, noteFx: false, preset: false,
      inserts: true, engineHeaderRow: false, dice: false, missingEngine: true,
    };
  }
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
    missingEngine: false,
  };
}
