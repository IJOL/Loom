// AudioWorklet loader for the sidechain duck detector.
//
// Same strategy as loom-node/drums-node/sampler-node: Vite bundles
// duck-processor.ts (+ its imports) into a separate JS asset via `?worker&url`,
// and the processor is referenced ONLY through that URL and its registered string
// name (from the worklet-code-free processor-name module).
import duckProcessorUrl from './duck-processor.ts?worker&url';

// Cache the addModule promise per BaseAudioContext so OfflineAudioContext (the
// scene exporter) is supported too.
const moduleCache = new WeakMap<BaseAudioContext, Promise<void>>();

export async function loadDuckWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = moduleCache.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(duckProcessorUrl);
    // Drop the cache entry on failure so a later call can retry instead of
    // returning a cached rejection forever.
    p.catch(() => { if (moduleCache.get(ctx) === p) moduleCache.delete(ctx); });
    moduleCache.set(ctx, p);
  }
  return p;
}
