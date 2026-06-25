// src/samples/sample-cache.ts
// In-memory registry of decoded AudioBuffers, keyed by sampleId. Never
// serialised. Engines read buffers from here; hydration (a later plan) fills
// it from the SampleStore on session load.

import type { SampleStore } from './types';
import { bufferPeak, peakNormGain } from './sample-loudness';

const cache = new Map<string, AudioBuffer>();
// Memoized peak-normalization gain per sampleId (see sample-loudness.ts). Lazy:
// computed on first request, since only keymap-resolved spawns ask for it.
const normGains = new Map<string, number>();

export const sampleCache = {
  put(id: string, buf: AudioBuffer): void { cache.set(id, buf); normGains.delete(id); },
  get(id: string): AudioBuffer | undefined { return cache.get(id); },
  has(id: string): boolean { return cache.has(id); },
  clear(): void { cache.clear(); normGains.clear(); },

  /** Peak-normalization gain for `id` (keymap samples only — drumkits + multisample
   *  instruments). Boost-only toward -1 dBFS, capped, so quiet kits sit with the
   *  rest of the library without clipping. 1 when the buffer is absent. */
  normGain(id: string): number {
    const memo = normGains.get(id);
    if (memo !== undefined) return memo;
    const buf = cache.get(id);
    if (!buf) return 1;
    const g = peakNormGain(bufferPeak(buf));
    normGains.set(id, g);
    return g;
  },

  /** Return the decoded buffer for `id`, decoding from the store on a miss.
   *  decodeAudioData detaches its input, so we decode a copy of the bytes. */
  async ensureLoaded(
    ctx: AudioContext,
    id: string,
    store: SampleStore,
  ): Promise<AudioBuffer | undefined> {
    const hit = cache.get(id);
    if (hit) return hit;
    const asset = await store.get(id);
    if (!asset) return undefined;
    const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
    cache.set(id, buf);
    return buf;
  },
};
