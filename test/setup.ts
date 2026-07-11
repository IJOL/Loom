// Globalize node-web-audio-api so src/ code that calls `new AudioContext()`
// or `new OfflineAudioContext(...)` works under Vitest in Node.

import * as nwa from 'node-web-audio-api';

const g = globalThis as unknown as Record<string, unknown>;

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

// Sequencer uses `window.setTimeout` — alias window to globalThis.
if (!('window' in g)) g.window = g;
