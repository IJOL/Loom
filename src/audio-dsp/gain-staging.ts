// src/audio-dsp/gain-staging.ts
//
// SINGLE SOURCE OF TRUTH for Loom's gain staging. Every voice/sample's final
// level is the product of four tunable layers (then the user's lane fader, then
// the master soft-clip/limiter):
//
//   raw voice/sample
//     × output.trim          ← per-PRESET balance   (preset params['output.trim']; default 1)
//     × outputTrim (manifest)  ← per-ENGINE balance    (between synth engines)
//     × CATEGORY_GAIN[cat]   ← per-CATEGORY balance  (synth vs drum vs sampler vs audio)
//     × lane fader (user)
//     × master
//
// To rebalance: change the CATEGORY number HERE, the engine number in that
// engine plugin's manifest (`capabilities.outputTrim`, applied by the host —
// see plugins/capabilities.pluginSynthTrim), or set `output.trim` in a preset's
// `params` (read at voice spawn by each renderer). Nothing else should hardcode
// an output trim.
//
// The per-ENGINE table that used to live here is gone with the last built-in
// melodic engine: an engine now declares its own balance where its params and
// its presets already live. `synthTrim()` went with it — it had no callers left.

/** Per-category gain — the global balance BETWEEN families. `drum` carries what
 *  used to be DrumsWorkletEngine.SAMPLE_GAIN.
 *
 *  drum ≈ 3.0 from a real hand-mix (Daft Punk "Around the World", 2026-06-25): the
 *  user pushed drum/perc to the top for a sensible balance, so sample drum kits
 *  read louder. Sampler/audio stay at 1.0 (tune by ear here). The master soft-clip
 *  absorbs the hotter drum transients.
 *
 *  synth raised 0.5 → 1.2 (2026-06-30): the old 0.5 (halved for that drum-heavy
 *  mix) left melodic-led songs far too quiet — a real MIDI import (Untitled.mid,
 *  mostly plucked guitars) measured its synth lanes at ~-26 dBFS (VU barely off the
 *  floor) while the master had ~13 dB of headroom. 1.2 lifts every synth engine
 *  ~+7.6 dB; inter-engine balance (each manifest's outputTrim) and per-preset balance (output.trim)
 *  are unchanged since they scale together. */
export const CATEGORY_GAIN = {
  synth: 1.2,
  drum: 3.0,
  sampler: 1.0,
  audio: 1.0,
};

/** Shared sample-path constants (sampler + drums + audio clips), centralized. */
export const SAMPLE_OUTPUT_TRIM = 0.7; // headroom so a full-scale sample stays < 0 dBFS
export const SAMPLE_HEADROOM = 0.8;    // per-voice sample headroom (was the inline 0.8 in resolveSpawn)

