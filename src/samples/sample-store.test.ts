import { describe, it, expect } from 'vitest';
import { MemSampleStore } from './sample-store-mem';
import type { SampleAsset } from './types';

function asset(id: string): SampleAsset {
  return {
    id, name: `${id}.wav`, mime: 'audio/wav',
    bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    durationSec: 1, sampleRate: 44100, channels: 1, createdAt: 0,
  };
}

describe('MemSampleStore', () => {
  it('round-trips put/get/list/delete', async () => {
    const store = new MemSampleStore();
    await store.put(asset('smp-a'));
    await store.put(asset('smp-b'));

    expect((await store.get('smp-a'))?.name).toBe('smp-a.wav');
    expect((await store.list()).map((a) => a.id).sort()).toEqual(['smp-a', 'smp-b']);

    await store.delete('smp-a');
    expect(await store.get('smp-a')).toBeUndefined();
    expect((await store.list()).map((a) => a.id)).toEqual(['smp-b']);
  });
});
