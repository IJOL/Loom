// src/samples/types.ts
// Core sampler domain types: the persisted asset, a one-shot keymap entry,
// and the storage interface implemented by both the in-memory and IndexedDB
// stores.

/** A sample as persisted: the encoded file bytes plus cached metadata.
 *  Never holds decoded audio (that lives in sample-cache). */
export interface SampleAsset {
  id: string;            // 'smp-<base36>'
  name: string;          // original file name
  mime: string;          // 'audio/wav' | 'audio/mpeg' | ...
  bytes: ArrayBuffer;    // the file exactly as imported
  durationSec: number;   // cached metadata
  sampleRate: number;
  channels: number;
  createdAt: number;     // epoch ms (passed in by the caller, not read here)
}

/** One-shot keymap entry. Lives on a sampler lane (the instrument). A single
 *  entry spanning 0..127 = a melodic instrument; many single-note entries
 *  (loNote === hiNote) = a rack/kit. */
export interface KeymapEntry {
  sampleId: string;
  rootNote: number;   // midi at which the sample plays at natural pitch
  loNote: number;     // inclusive key-range low
  hiNote: number;     // inclusive key-range high
  gain?: number;      // linear, default 1
}

/** Persistence boundary. Implemented by sample-store-mem (tests/fallback) and
 *  sample-store (IndexedDB). */
export interface SampleStore {
  put(asset: SampleAsset): Promise<void>;
  get(id: string): Promise<SampleAsset | undefined>;
  list(): Promise<SampleAsset[]>;
  delete(id: string): Promise<void>;
}
