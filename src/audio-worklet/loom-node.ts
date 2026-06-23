// AudioWorklet loader + node wrapper for the Loom synthesis processor.
//
// Loading strategy: Blob URL from a JS source string (see loom-processor.ts).
// Vite 5 does not transpile .ts files referenced via `new URL('./f.ts', import.meta.url)`;
// it embeds raw TypeScript with MIME type video/mp2t, which browsers reject in
// addModule. The Blob URL pattern (same as recorder-worklet.ts) is reliable in
// both dev and build (--base=/Loom/) — the source is inlined in the main bundle
// and the Blob is constructed at runtime, so no asset URL rewriting is needed.
import { LOOM_PROCESSOR_NAME, LOOM_PROCESSOR_SOURCE } from './loom-processor';

// Cache the promise per AudioContext (same pattern as recorder-worklet.ts).
const moduleCache = new WeakMap<AudioContext, Promise<void>>();

export async function loadLoomWorklet(ctx: AudioContext): Promise<void> {
  let p = moduleCache.get(ctx);
  if (!p) {
    const blob = new Blob([LOOM_PROCESSOR_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    moduleCache.set(ctx, p);
  }
  return p;
}

export class LoomWorkletNode {
  readonly node: AudioWorkletNode;
  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, LOOM_PROCESSOR_NAME, { outputChannelCount: [2] });
  }
  connect(dest: AudioNode): void { this.node.connect(dest); }
  disconnect(): void { this.node.disconnect(); }
}
