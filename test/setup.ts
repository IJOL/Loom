// Globalize node-web-audio-api so src/ code that calls `new AudioContext()`
// or `new OfflineAudioContext(...)` works under Vitest in Node.

import * as nwa from 'node-web-audio-api';

const g = globalThis as unknown as Record<string, unknown>;

// lit-html's dev build announces itself on stderr the first time any test file
// imports it ("Lit is in dev mode..."), attributed to whichever file got there
// first. Its OTHER dev warnings — malformed templates, duplicate bindings — are
// worth having, so don't resolve the production build; silence just the banner
// through the hook lit provides for it: development/lit-html.js checks both the
// full text AND the short code against this set before printing.
const litWarnings = (g.litIssuedWarnings ??= new Set<string>()) as Set<string>;
litWarnings.add('dev-mode');

for (const [name, value] of Object.entries(nwa)) {
  if (typeof value === 'function' && !(name in g)) {
    g[name] = value;
  }
}

// AudioWorklet test doubles. The design tests the pure DSP kernel directly
// (src/audio-dsp/*.test.ts) and verifies the real worklet's audio via
// Playwright — node-web-audio-api cannot register/run our TypeScript processor.
// But importing src/audio-worklet/loom-node.ts (transitively, via the allocator)
// evaluates loom-processor.ts, whose top-level `class extends AudioWorkletProcessor`
// + `registerProcessor(...)` need those globals to exist; and a WorkletLaneEngine
// constructs `new AudioWorkletNode(ctx,'loom-processor')`, which node-web-audio-api
// rejects (processor not registered). Provide harmless stubs so allocation LOGIC
// tests load and run without exercising the real worklet.
class StubAudioWorkletProcessor {
  readonly port = { postMessage() { /* no-op */ }, onmessage: null as unknown };
}
g.AudioWorkletProcessor = StubAudioWorkletProcessor;
g.registerProcessor = () => { /* no-op in the test harness */ };
// Override node-web-audio-api's AudioWorkletNode (which throws on an unregistered
// processor) with a silent fake exposing only what LoomWorkletNode touches.
g.AudioWorkletNode = class {
  readonly port = { postMessage() { /* no-op */ }, onmessage: null as unknown };
  connect() { /* no-op */ }
  disconnect() { /* no-op */ }
};
// node-web-audio-api's real AudioWorklet.addModule tries to IMPORT our TS processor
// and rejects (ERR_MODULE_NOT_FOUND). The offline scene recorder now registers the
// worklet modules on its fresh OfflineAudioContext before building nodes (a browser
// requires it, else InvalidStateError) — and logs a rejected load. The fake node
// above already ignores registration, so stub addModule to RESOLVE: keeps the
// offline-render tests quiet without changing what they exercise. Tests that need
// the strict browser contract (offline-worklet-registration.test.ts) install their
// own spy over this.
const AW = g.AudioWorklet as { prototype?: Record<string, unknown> } | undefined;
if (AW?.prototype) {
  AW.prototype.addModule = () => Promise.resolve();
}

// A RENDERED BUFFER IS BORROWED, NOT OWNED — copy it before the next render.
//
// node-web-audio-api backs an AudioBuffer with Rust-owned memory, and
// getChannelData() hands back a Float32Array VIEW onto it. When the
// OfflineAudioContext that produced it is collected, that memory is freed and
// reused, so a view held across a later render silently starts reading
// somebody else's bytes: zeros, garbage, or NaN, depending on what landed
// there. Nothing throws. The test just compares the wrong numbers.
//
// This is why a render helper must return `.slice()` and never the view, and
// why a window into one must be `.slice(from, to)` rather than `.subarray`.
// It cannot be fixed centrally by patching getChannelData to copy: real code
// FILLS buffers through the same call (`ir.getChannelData(0).set(left)`), and
// a copy would send those writes nowhere.
//
// Found in the bitcrusher suite, where a 16-bit reference rendered first was
// compared against a 2-bit render made two contexts later and came back
// bit-identical to it — the reference had been freed and zeroed in between.
// Sequencer uses `window.setTimeout` — alias window to globalThis.
if (!('window' in g)) g.window = g;
