// src/audio-dsp/gain-staging.ts
//
// SINGLE SOURCE OF TRUTH for Loom's gain staging. Every voice/sample's final
// level is the product of four tunable layers (then the user's lane fader, then
// the master soft-clip/limiter):
//
//   raw voice/sample
//     × preset.trim          ← per-PRESET balance   (lives in each preset JSON; default 1)
//     × ENGINE_TRIM[engine]  ← per-ENGINE balance    (between synth engines)
//     × CATEGORY_GAIN[cat]   ← per-CATEGORY balance  (synth vs drum vs sampler vs audio)
//     × lane fader (user)
//     × master
//
// To rebalance: change a number HERE (engine/category) or a preset's "trim" in
// its JSON. Nothing else should hardcode an output trim.

/** Per-engine output trim — balance BETWEEN synth engines. These are the historical
 *  per-voice output factors that used to live hardcoded in each renderer. They bake
 *  in each engine's voicing (e.g. FM sums 4 carriers → 0.25; Karplus is peak-
 *  normalized to 0.8 headroom). Tune these to make one engine sit with the others. */
export const ENGINE_TRIM: Record<string, number> = {
  tb303: 0.3,
  subtractive: 0.4,
  fm: 0.25,
  wavetable: 0.6,
  westcoast: 0.5,
  karplus: 0.8,
};

/** Per-category gain — the global balance BETWEEN families. 1.0 = each path's
 *  historical level (so introducing this layer changes nothing until tuned).
 *  `drum` carries what used to be DrumsWorkletEngine.SAMPLE_GAIN (2.0). */
export const CATEGORY_GAIN = {
  synth: 1.0,
  drum: 2.0,
  sampler: 1.0,
  audio: 1.0,
};

/** Shared sample-path constants (sampler + drums + audio clips), centralized. */
export const SAMPLE_OUTPUT_TRIM = 0.7; // headroom so a full-scale sample stays < 0 dBFS
export const SAMPLE_HEADROOM = 0.8;    // per-voice sample headroom (was the inline 0.8 in resolveSpawn)

/** Output trim for a synth engine = its per-engine trim × the synth category gain. */
export function synthTrim(engineId: string): number {
  return (ENGINE_TRIM[engineId] ?? 1) * CATEGORY_GAIN.synth;
}
