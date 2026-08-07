// @loom/plugin-sdk — the published surface a Loom plugin author compiles against.
// Everything here ends up INSIDE the plugin's own bundle: the runtime ABI
// (globalThis.Loom) carries no DSP, which is what keeps it small enough to hold
// stable across versions.
export * from './types';
export * from './manifest';
export * from './fx';
export * from './dsp/util';
export * from './dsp/velocity';
export { Adsr } from './dsp/adsr';
export { ModEnvHost } from './dsp/mod-env-host';
// The synthesis primitives. What earns a place here is fitting in ANY engine,
// not being used by two of ours today: a unison stack fits everything with
// oscillators, and a wavefolder is a primitive rather than a trait of the one
// engine that reaches for it. What stays inside a plugin is what IS that
// engine's identity — its wave tables, its accent curve.
export * from './dsp/osc';
export * from './dsp/sync-osc';
export * from './dsp/ladder';
export * from './dsp/filter';
export * from './dsp/unison';
export * from './dsp/fold';
export * from './dsp/comb';
export * from './dsp/filter-stack';   // re-exports ./filter-kinds
// Pure maths too, despite the name: a synthetic impulse response is Float32Array
// arithmetic with no AudioContext. It is the reverb INSERT that feeds the result
// to a ConvolverNode.
export * from './dsp/reverb-ir';
// ── Main-thread graph builders ─────────────────────────────────────────────
// Everything above this line runs inside the AudioWorklet, per sample, with no
// AudioContext. What follows BUILDS NATIVE WEB AUDIO NODES and can only run on
// the main thread — because that is what an insert is in Loom. Same folder, two
// species; importing one of these into a renderer will not work.
export * from './dsp/modulated-delay';
export * from './dsp/signal-max';
export * from './dsp/envelope-follower';
