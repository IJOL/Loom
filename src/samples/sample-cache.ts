// src/samples/sample-cache.ts
// In-memory registry of decoded AudioBuffers, keyed by sampleId. Never
// serialised. Engines read buffers from here; hydration (a later plan) fills
// it from the SampleStore on session load.

import type { SampleStore } from './types';

const cache = new Map<string, AudioBuffer>();

export const sampleCache = {
  put(id: string, buf: AudioBuffer): void { cache.set(id, buf); },
  get(id: string): AudioBuffer | undefined { return cache.get(id); },
  has(id: string): boolean { return cache.has(id); },
  clear(): void { cache.clear(); },

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
