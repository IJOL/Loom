import { describe, it, expect } from 'vitest';
import { warpCache } from './warp-cache';

describe('warpCache.invalidate', () => {
  it('drops only the keys for the given sampleId', async () => {
    const buf = {} as AudioBuffer;
    await warpCache.ensure('s1|m|1.000', () => buf);
    await warpCache.ensure('s2|m|1.000', () => buf);
    warpCache.invalidate('s1');
    expect(warpCache.has('s1|m|1.000')).toBe(false);
    expect(warpCache.has('s2|m|1.000')).toBe(true);
    warpCache.clear();
  });
});
