// src/samples/warp-cache.ts
// In-memory cache of piecewise-warped AudioBuffers, keyed by a string (sampleId +
// markers + gate). Mirrors stretch-cache but string-keyed because a warp result
// depends on the whole marker set, not a single ratio. Never serialised.
const cache = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<void>>();

export const warpCache = {
  get(key: string): AudioBuffer | undefined { return cache.get(key); },
  has(key: string): boolean { return cache.has(key); },
  async ensure(key: string, render: () => AudioBuffer): Promise<void> {
    if (cache.has(key)) return;
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = (async () => { cache.set(key, render()); })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  },
  invalidate(sampleId: string): void {
    const prefix = `${sampleId}|`;
    for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
    for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
  },
  clear(): void { cache.clear(); inflight.clear(); },
};
