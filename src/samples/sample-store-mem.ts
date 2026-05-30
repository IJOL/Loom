// src/samples/sample-store-mem.ts
// In-memory SampleStore. Used by tests and as a non-persistent fallback when
// IndexedDB is unavailable.

import type { SampleAsset, SampleStore } from './types';

export class MemSampleStore implements SampleStore {
  private map = new Map<string, SampleAsset>();

  async put(asset: SampleAsset): Promise<void> {
    this.map.set(asset.id, asset);
  }
  async get(id: string): Promise<SampleAsset | undefined> {
    return this.map.get(id);
  }
  async list(): Promise<SampleAsset[]> {
    return Array.from(this.map.values());
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}
