import { describe, it, expect, beforeEach } from 'vitest';
import { stretchCache } from './stretch-cache';

const fakeBuf = (len: number) => ({ length: len } as unknown as AudioBuffer);

describe('stretchCache', () => {
  beforeEach(() => stretchCache.clear());

  it('returns undefined on a miss, the buffer after ensure', async () => {
    expect(stretchCache.get('smp-a', 1.5)).toBeUndefined();
    let calls = 0;
    await stretchCache.ensure('smp-a', 1.5, () => { calls++; return fakeBuf(99); });
    expect(stretchCache.get('smp-a', 1.5)?.length).toBe(99);
    // second ensure with same key does not re-render
    await stretchCache.ensure('smp-a', 1.5, () => { calls++; return fakeBuf(1); });
    expect(calls).toBe(1);
  });

  it('keys by rounded ratio so 1.500 and 1.5004 share an entry', async () => {
    await stretchCache.ensure('smp-b', 1.5, () => fakeBuf(10));
    expect(stretchCache.get('smp-b', 1.5004)?.length).toBe(10);
  });
});
