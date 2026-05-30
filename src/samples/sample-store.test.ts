import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { MemSampleStore } from './sample-store-mem';
import type { SampleAsset } from './types';
import { IdbSampleStore } from './sample-store';

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

describe('IdbSampleStore', () => {
  it('round-trips put/get/list/delete through IndexedDB', async () => {
    const store = new IdbSampleStore('tb303-samples-test');
    await store.put(asset('smp-1'));
    await store.put(asset('smp-2'));

    expect((await store.get('smp-1'))?.name).toBe('smp-1.wav');
    expect((await store.list()).map((a) => a.id).sort()).toEqual(['smp-1', 'smp-2']);

    await store.delete('smp-1');
    expect(await store.get('smp-1')).toBeUndefined();
    expect((await store.list()).map((a) => a.id)).toEqual(['smp-2']);
  });

  it('preserves the bytes ArrayBuffer through a round-trip', async () => {
    const store = new IdbSampleStore('tb303-samples-test2');
    const a = asset('smp-bytes');
    await store.put(a);
    const got = await store.get('smp-bytes');
    expect(new Uint8Array(got!.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
