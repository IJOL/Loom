// src/audio-dsp/gain-staging.ts
//
// SINGLE SOURCE OF TRUTH for Loom's gain staging. Every voice/sample's final
// level is the product of four tunable layers (then the user's lane fader, then
// the master soft-clip/limiter):
//
//   raw voice/sample
//     × output.trim          ← per-PRESET balance   (preset params['output.trim']; default 1)
//     × ENGINE_TRIM[engine]  ← per-ENGINE balance    (between synth engines)
//     × CATEGORY_GAIN[cat]   ← per-CATEGORY balance  (synth vs drum vs sampler vs audio)
//     × lane fader (user)
//     × master
//
// To rebalance: change a number HERE (engine/category) or set `output.trim` in a
// preset's `params` — read at voice spawn by each renderer (e.g. karplus/subtractive
// `* param(p,'output.trim',1)`). Nothing else should hardcode an output trim.

/** Per-engine output trim — balance BETWEEN synth engines. These are the historical
 *  per-voice output factors that used to live hardcoded in each renderer. They bake
 *  in each engine's voicing (e.g. FM sums 4 carriers → 0.25; Karplus is peak-
 *  normalized to 0.8 headroom). Tune these to make one engine sit with the others. */
export const ENGINE_TRIM: Record<string, number> = {
  tb303: 0.45, // raised from 0.3 (×1.5): after the synth-0.5 rebalance the TB-303
               // acid bass sat too quiet — demos needed the 303 fader at the top.
  subtractive: 0.25, // lowered from 0.4: its "Sub"/bass presets sat too loud vs the
                     // 303 in the demos (user mixed the sub to ~42%). Global, so
                     // Around the World's subtractive leads drop too — accepted.
  fm: 0.179, // was 0.25, ÷1.4 (2026-07-25): fm scaled RAW velocity — the AudioWorklet
             // port dropped the `0.3 + 1.1·v` curve — so restoring it multiplied a
             // full-velocity note by velGain01(1) = 1.4. What the division puts back
             // is exactly the FULL-velocity level (rms ratio 1.002 vs the pre-change
             // render) — that one point, not the range. Below it every note is now
             // LOUDER than it was, because the restored curve has a 0.3 floor where
             // raw velocity had none. The lift is (0.3 + 1.1·v) / (1.4·v), which has
             // no bound as v → 0: +0.73 dB at the app's default velocity of 90,
             // +9.3 dB at a tenth of full scale, and ×28 (+29 dB) at MIDI velocity 1,
             // the softest note a clip can carry. (Measured values run ~0.02 dB above
             // those, since the trims are stored rounded to three decimals.) That lift
             // is the point (a soft note was a third too quiet on fm and karplus, and
             // MIDI-import passages went missing), but it is a change, not a
             // restoration, and only v=1.0 is where it was. Pinned at each of those
             // velocities in gain-staging-velocity.test.ts.
  wavetable: 0.6,
  westcoast: 0.5,
  // karplus is NOT here any more: it ships as a plugin, and its balance lives in
  // its manifest as `outputTrim` (plugins/karplus/plugin.json). The host reads it
  // through plugin-capabilities.pluginSynthTrim and multiplies it in, so there is
  // still exactly one owner of the number — just no longer this table.
};

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
 *  mostly karplus/guitars) measured its synth lanes at ~-26 dBFS (VU barely off the
 *  floor) while the master had ~13 dB of headroom. 1.2 lifts every synth engine
 *  ~+7.6 dB; inter-engine balance (ENGINE_TRIM) and per-preset balance (output.trim)
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

/** Output trim for a synth engine = its per-engine trim × the synth category gain. */
export function synthTrim(engineId: string): number {
  return (ENGINE_TRIM[engineId] ?? 1) * CATEGORY_GAIN.synth;
}
