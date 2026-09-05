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

/** Melodic per-voice headroom, applied to the lane's summed output in
 *  VoiceManager (live worklet and offline kernel share that path). Voices used
 *  to sum RAW: a real westcoast patch at 8 voices measured raw RMS 1.03 —
 *  sustained overload — and the master limiter ground the whole lane into
 *  noise (2026-09-05 repro). 0.5 (−6 dB) moves the melodic operating point
 *  down; it also settles the standing "the bank rides the master knee" issue,
 *  since every melodic bank ran hot against MASTER_SOFTCLIP_KNEE. Relative
 *  balance between engines/presets is untouched — they all scale together. */
export const POLY_VOICE_HEADROOM = 0.5;

/** Where the LANE soft clip stops being transparent. Deliberately ABOVE the
 *  master's 0.8 knee: a single voice must reach the master untouched, and only
 *  a pileup — several voices summing past this — saturates, inside its own
 *  lane, instead of driving the master stage into continuous grinding. */
export const LANE_SOFTCLIP_KNEE = 0.9;

/** The absolute lane ceiling. Kept strictly under 1 — the same contract the
 *  master curve keeps with its ~0.95 — so even a float-saturated tanh cannot
 *  land the lane's output ON full scale. */
const LANE_SOFTCLIP_CEIL = 0.98;

/** The only stage that treats a pileup differently from a note: identity below
 *  the knee, then a tanh that maps everything above — any overshoot included —
 *  into (knee, ceil), so the lane's output stays under ±1. Slope is 1 at the
 *  knee (tanh′(0) = 1), so there is no corner to hear. */
export function laneSoftClip(x: number): number {
  const ax = Math.abs(x);
  if (ax <= LANE_SOFTCLIP_KNEE) return x;
  const span = LANE_SOFTCLIP_CEIL - LANE_SOFTCLIP_KNEE;
  return Math.sign(x) * (LANE_SOFTCLIP_KNEE + span * Math.tanh((ax - LANE_SOFTCLIP_KNEE) / span));
}

