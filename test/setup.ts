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

// Sequencer uses `window.setTimeout` — alias window to globalThis.
if (!('window' in g)) g.window = g;
