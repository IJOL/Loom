// src/engines/sampler.ts
//
// Phase 4 cutover: the legacy SamplerEngine + SamplerVoice (Web Audio
// node-per-note sample playback) were deleted. Sampler lanes now play through
// the AudioWorklet (SamplerWorkletEngine + the sampler processor/kernel), which
// carries the full sampler UI (keymap / pad rack / sample viewer) itself. This
// file keeps DATA the rest of the app still imports: guessRootNoteFromName (used
// by the worklet engine's import path) and the sampler param spec, plus a
// registered metadata descriptor.

import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',        label: 'Gain',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16,  default: 8 },
];

const NOTE_NAMES: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5,
  'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

/** Guess a sample's root MIDI note from its file name. Recognises a note name
 *  with octave (e.g. `C3`, `A#4`, `Db2`) or a bare MIDI number (`60`); falls
 *  back to C3 = 60 when nothing matches. Octave convention: C3 = 60 (yamaha). */
export function guessRootNoteFromName(fileName: string): number {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  // Note name + octave: C3, A#4, Db-1, gb 2 …
  const nm = base.match(/(?:^|[^a-z])([a-gA-G])([#b]?)\s*(-?\d{1,2})(?![\d])/);
  if (nm) {
    const semis = NOTE_NAMES[(nm[1] + nm[2]).toLowerCase()];
    if (semis !== undefined) {
      const midi = (Number(nm[3]) + 2) * 12 + semis; // C3 = 60 ⇒ octave+2
      if (midi >= 0 && midi <= 127) return midi;
    }
  }
  // Bare MIDI number: only when not glued to other digits.
  const mm = base.match(/(?:^|[^0-9])(\d{1,3})(?![0-9])/);
  if (mm) {
    const midi = Number(mm[1]);
    if (midi >= 0 && midi <= 127) return midi;
  }
  return 60;
}

function makeSamplerDescriptor() {
  return createDescriptorEngine({
    id: 'sampler',
    name: 'Sampler',
    polyphony: 'poly',
    params: SAMPLER_PARAMS,
    presets: () => [],
  });
}

registerEngineFactory('sampler', makeSamplerDescriptor);
registerEngine(makeSamplerDescriptor());
