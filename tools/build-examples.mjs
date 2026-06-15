// tools/build-examples.mjs
// Helper to (re)generate CANDIDATE examples per style using the generators, for a
// human to audition and curate. The SOURCE OF TRUTH is the curated JSON in
// public/examples/*.json (hand-written + ear-checked). This stub documents intent;
// flesh it out only if bulk regeneration is needed.
//
// Design notes:
//   • Melodic examples use scale-degree indices (not absolute MIDI) so they
//     remain in-key regardless of the project's root/tonality setting.
//   • Beat examples use GM drum note numbers (kick=36, snare=38, closed hat=42,
//     open hat=46, clap=39).
//   • 1 bar 4/4 = 16 steps = 384 ticks; 1 step = 24 ticks.
//   • Four-on-the-floor kicks land at ticks 0, 96, 192, 288 (steps 0, 4, 8, 12).
//   • Each file format: { "style": "<id>", "examples": [ <Example>, ... ] }
//   • Validated at load-time by src/session/example-loader.ts :: validateExample().
//
// To regenerate from scratch, replace the console.log below with code that
// writes JSON to public/examples/<style>.json, then commit + ear-check the result.

console.log('build-examples: curated set lives in public/examples/*.json — edit those directly.');
