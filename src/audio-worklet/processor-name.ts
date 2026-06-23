// The registered AudioWorklet processor name. Lives in its own module — with NO
// worklet-scope code — so the main thread can import the name WITHOUT pulling in
// loom-processor.ts (whose top-level `class extends AudioWorkletProcessor` +
// `registerProcessor(...)` throw on the main thread, where those globals don't
// exist). loom-processor.ts is referenced ONLY via the `?worker&url` import in
// loom-node.ts, so it is bundled as a separate worklet chunk and never runs on
// the main thread.
export const LOOM_PROCESSOR_NAME = 'loom-processor';
