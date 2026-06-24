// src/audio-dsp/sample/types.ts
// Shared types for the worklet-side sample bank + sample-playing renderers.
// Pure: no Web Audio. The main thread decodes audio and posts the raw channels
// to the worklet bank (keyed by sampleId); the worklet plays them.

/** Decoded sample data held in the worklet sample bank. */
export interface SampleData {
  channels: Float32Array[];
  sampleRate: number;
}

/** A fully-resolved sample spawn (main thread did keymap + repitch + pad params).
 *  The worklet does no keymap lookup — it plays exactly what the spawn describes. */
export interface SampleSpawn {
  sampleId: string;          // key into the worklet sample bank
  beginSec: number;
  gateSec: number;
  rate: number;              // playbackRate (repitch × tune, or warp varispeed)
  offsetSec: number;         // start offset into the buffer
  loop: boolean;
  loopStartSec: number;
  loopEndSec: number;
  // per-pad voice chain (sampler); audio channel sends neutral defaults
  cutoff: number;            // 0..1 → 60·300^x Hz
  res: number;               // 0..1
  attack: number;
  decay: number;
  level: number;
  pan: number;
  rev: number;
  dly: number;
  gain: number;              // engine master gain × entry gain × velocity × OUTPUT_TRIM
}
