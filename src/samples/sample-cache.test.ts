import { describe, it, expect, beforeEach } from 'vitest';
import { sampleCache } from './sample-cache';
import type { SampleStore } from './types';

function makeBuffer(): AudioBuffer {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.createBuffer(1, 100, 44100);
}

describe('sampleCache', () => {
  beforeEach(() => sampleCache.clear());

  it('put/get/has/clear behave as a keyed buffer store', () => {
    const buf = makeBuffer();
    expect(sampleCache.has('a')).toBe(false);
    sampleCache.put('a', buf);
    expect(sampleCache.has('a')).toBe(true);
    expect(sampleCache.get('a')).toBe(buf);
    sampleCache.clear();
    expect(sampleCache.has('a')).toBe(false);
  });

  it('ensureLoaded returns a cache hit without touching the store', async () => {
    const buf = makeBuffer();
    sampleCache.put('a', buf);
    const store: SampleStore = {
      get: () => { throw new Error('store should not be hit on cache hit'); },
      put: async () => {}, list: async () => [], delete: async () => {},
    };
    const ctx = new OfflineAudioContext(1, 1, 44100) as unknown as AudioContext;
    expect(await sampleCache.ensureLoaded(ctx, 'a', store)).toBe(buf);
  });
});
