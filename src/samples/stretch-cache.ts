// In-memory cache of time-stretched AudioBuffers, keyed by sampleId + ratio
// (rounded to 1e-3). Never serialised; re-derived lazily after load.

const cache = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<void>>();

function key(sampleId: string, ratio: number): string {
  return `${sampleId}|${ratio.toFixed(3)}`;
}

export const stretchCache = {
  get(sampleId: string, ratio: number): AudioBuffer | undefined {
    return cache.get(key(sampleId, ratio));
  },
  has(sampleId: string, ratio: number): boolean {
    return cache.has(key(sampleId, ratio));
  },
  /** Render+store if absent. `render` is sync (OLA is fast); coalesces
   *  concurrent calls for the same key. */
  async ensure(sampleId: string, ratio: number, render: () => AudioBuffer): Promise<void> {
    const k = key(sampleId, ratio);
    if (cache.has(k)) return;
    const existing = inflight.get(k);
    if (existing) return existing;
    const p = (async () => { cache.set(k, render()); })().finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  },
  clear(): void { cache.clear(); inflight.clear(); },
};
