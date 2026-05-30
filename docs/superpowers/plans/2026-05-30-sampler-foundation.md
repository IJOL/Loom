# Sampler Foundation Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sampler's foundation — an IndexedDB-backed sample store, an in-memory decoded-buffer cache, sample-import metadata, and a `sampler` `SynthEngine` that plays one-shot samples pitched per MIDI note through a per-voice lowpass + amp envelope.

**Architecture:** A new `src/samples/` domain owns sample persistence (`SampleStore` interface + IndexedDB and in-memory implementations), the decoded-`AudioBuffer` cache, import metadata, and pure keymap resolution. A new `src/engines/sampler.ts` implements `SynthEngine` exactly like `src/engines/wavetable.ts`: per-note `AudioBufferSourceNode → BiquadFilter(lowpass) → GainNode → output`, resolving the buffer from the cache via the lane keymap and repitching by `2^((midi-root)/12)`.

**Tech Stack:** TypeScript, Web Audio API (`AudioBufferSourceNode`, `BiquadFilterNode`), IndexedDB, Vitest (`environment: node`, `node-web-audio-api` globalised in `test/setup.ts`), `fake-indexeddb` (added in Task 4) for store tests.

**Scope of this plan (Phases 1–2 of the spec):** sample store + cache + import + the one-shot **melodic** engine, all unit/DSP-tested. The engine is audible standalone (built-in amp envelope). **Not in this plan** (later plans): loading UI + keymap editor (Phase 3, e2e-verified), loop/song clips + scheduler integration (Phase 4), session persistence/hydration + missing-sample handling (Phase 5), polish (Phase 6). Voice-stealing/poly-cap enforcement and modulation-host wiring to the voice are also deferred — the `poly.voices` param is stored but not yet enforced, and each voice stops itself when its envelope ends.

Spec: [docs/superpowers/specs/2026-05-30-sampler-engine-design.md](../specs/2026-05-30-sampler-engine-design.md)

---

## File Structure

**Create:**
- `src/samples/types.ts` — `SampleAsset`, `KeymapEntry`, `SampleStore` interface.
- `src/samples/sample-store-mem.ts` — in-memory `SampleStore` (Map). Used by higher-level tests and as a non-persistent fallback.
- `src/samples/sample-store.ts` — IndexedDB `SampleStore` implementation.
- `src/samples/sample-store.test.ts` — store round-trip tests (mem + IndexedDB via `fake-indexeddb`).
- `src/samples/import.ts` — `buildSampleAsset` (pure metadata) + `importFile` (browser plumbing, not unit-tested).
- `src/samples/import.test.ts` — `buildSampleAsset` metadata test.
- `src/samples/sample-cache.ts` — decoded-`AudioBuffer` cache singleton (`put`/`get`/`has`/`clear`/`ensureLoaded`).
- `src/samples/sample-cache.test.ts` — cache behaviour test.
- `src/samples/keymap.ts` — pure `keymapEntryFor` + `repitchRate`.
- `src/samples/keymap.test.ts` — resolution + repitch tests.
- `src/engines/sampler.ts` — `SamplerEngine` + `SamplerVoice`.
- `src/engines/sampler.test.ts` — engine param/registry unit tests.
- `src/engines/sampler.dsp.test.ts` — real-DSP playback tests.

**Modify:**
- `package.json` — add `fake-indexeddb` devDependency (Task 4).

---

## Task 1: Sample types + in-memory store

**Files:**
- Create: `src/samples/types.ts`
- Create: `src/samples/sample-store-mem.ts`
- Test: `src/samples/sample-store.test.ts`

- [ ] **Step 1: Write the types**

Create `src/samples/types.ts`:

```ts
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
```

- [ ] **Step 2: Write the in-memory store**

Create `src/samples/sample-store-mem.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing test**

Create `src/samples/sample-store.test.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/sample-store.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/samples/types.ts src/samples/sample-store-mem.ts src/samples/sample-store.test.ts
git commit -m "feat(samples): sample types + in-memory store"
```

---

## Task 2: Import metadata (`buildSampleAsset`)

**Files:**
- Create: `src/samples/import.ts`
- Test: `src/samples/import.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/samples/import.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSampleAsset } from './import';

describe('buildSampleAsset', () => {
  it('derives duration/sampleRate/channels from the decoded buffer', () => {
    // node-web-audio-api is globalised in test/setup.ts.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = ctx.createBuffer(2, 22050, 44100); // 0.5s, stereo

    const asset = buildSampleAsset({
      id: 'smp-x',
      name: 'kick.wav',
      mime: 'audio/wav',
      bytes: new Uint8Array([0, 1, 2]).buffer,
      buffer,
      createdAt: 123,
    });

    expect(asset.id).toBe('smp-x');
    expect(asset.channels).toBe(2);
    expect(asset.sampleRate).toBe(44100);
    expect(asset.durationSec).toBeCloseTo(0.5, 3);
    expect(asset.createdAt).toBe(123);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/import.test.ts`
Expected: FAIL — `buildSampleAsset` is not exported / module not found.

- [ ] **Step 3: Write the implementation**

Create `src/samples/import.ts`:

```ts
// src/samples/import.ts
// Turning an imported file into a SampleAsset. The pure metadata step is
// separated from the browser File/decode plumbing so it is unit-testable.

import type { SampleAsset } from './types';

/** Pure: assemble a SampleAsset from already-read bytes + a decoded buffer. */
export function buildSampleAsset(opts: {
  id: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  buffer: AudioBuffer;
  createdAt: number;
}): SampleAsset {
  return {
    id: opts.id,
    name: opts.name,
    mime: opts.mime,
    bytes: opts.bytes,
    durationSec: opts.buffer.duration,
    sampleRate: opts.buffer.sampleRate,
    channels: opts.buffer.numberOfChannels,
    createdAt: opts.createdAt,
  };
}

/** Allocate a fresh sample id. */
export function newSampleId(): string {
  return `smp-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

/** Browser plumbing: read a File, decode it, build the asset. Not unit-tested
 *  (depends on File + decodeAudioData); verified manually / e2e in a later plan.
 *  decodeAudioData detaches its input ArrayBuffer, so we decode a copy and keep
 *  the original bytes for storage. */
export async function importFile(file: File, ctx: AudioContext): Promise<SampleAsset> {
  const bytes = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(bytes.slice(0));
  return buildSampleAsset({
    id: newSampleId(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    bytes,
    buffer,
    createdAt: Date.now(),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/import.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/samples/import.ts src/samples/import.test.ts
git commit -m "feat(samples): buildSampleAsset import metadata"
```

---

## Task 3: Decoded-buffer cache

**Files:**
- Create: `src/samples/sample-cache.ts`
- Test: `src/samples/sample-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/samples/sample-cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/sample-cache.test.ts`
Expected: FAIL — module `./sample-cache` not found.

- [ ] **Step 3: Write the implementation**

Create `src/samples/sample-cache.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/sample-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/samples/sample-cache.ts src/samples/sample-cache.test.ts
git commit -m "feat(samples): decoded AudioBuffer cache"
```

---

## Task 4: IndexedDB store

**Files:**
- Modify: `package.json` (add `fake-indexeddb` devDependency)
- Create: `src/samples/sample-store.ts`
- Test: `src/samples/sample-store.test.ts` (append an IndexedDB suite)

- [ ] **Step 1: Add the test dependency**

Run: `npm install -D fake-indexeddb`
Expected: `package.json` gains `"fake-indexeddb"` under devDependencies; `npm install` completes.

- [ ] **Step 2: Write the failing test (append to the existing file)**

Append to `src/samples/sample-store.test.ts` (keep the existing `MemSampleStore` suite above it):

```ts
import 'fake-indexeddb/auto';
import { IdbSampleStore } from './sample-store';

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/sample-store.test.ts`
Expected: FAIL — module `./sample-store` / `IdbSampleStore` not found. (The `MemSampleStore` suite still passes.)

- [ ] **Step 4: Write the implementation**

Create `src/samples/sample-store.ts`:

```ts
// src/samples/sample-store.ts
// IndexedDB-backed SampleStore. One object store keyed by SampleAsset.id.
// ArrayBuffer bytes survive structured-clone, so assets persist verbatim.

import type { SampleAsset, SampleStore } from './types';

const DEFAULT_DB = 'tb303-samples';
const STORE = 'samples';
const VERSION = 1;

export class IdbSampleStore implements SampleStore {
  constructor(private dbName: string = DEFAULT_DB) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async put(asset: SampleAsset): Promise<void> {
    await this.run('readwrite', (s) => s.put(asset) as IDBRequest<IDBValidKey>);
  }
  async get(id: string): Promise<SampleAsset | undefined> {
    return (await this.run('readonly', (s) => s.get(id) as IDBRequest<SampleAsset | undefined>)) ?? undefined;
  }
  async list(): Promise<SampleAsset[]> {
    return this.run('readonly', (s) => s.getAll() as IDBRequest<SampleAsset[]>);
  }
  async delete(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/sample-store.test.ts`
Expected: PASS (3 tests: the Mem suite + 2 IndexedDB tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/samples/sample-store.ts src/samples/sample-store.test.ts
git commit -m "feat(samples): IndexedDB sample store"
```

---

## Task 5: Keymap resolution + repitch (pure)

**Files:**
- Create: `src/samples/keymap.ts`
- Test: `src/samples/keymap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/samples/keymap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { keymapEntryFor, repitchRate } from './keymap';
import type { KeymapEntry } from './types';

const melodic: KeymapEntry[] = [{ sampleId: 'lead', rootNote: 60, loNote: 0, hiNote: 127 }];
const rack: KeymapEntry[] = [
  { sampleId: 'kick',  rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 'snare', rootNote: 38, loNote: 38, hiNote: 38 },
];

describe('keymapEntryFor', () => {
  it('a single full-range entry matches any note (melodic)', () => {
    expect(keymapEntryFor(melodic, 24)?.sampleId).toBe('lead');
    expect(keymapEntryFor(melodic, 96)?.sampleId).toBe('lead');
  });
  it('single-note entries match only their note (rack)', () => {
    expect(keymapEntryFor(rack, 36)?.sampleId).toBe('kick');
    expect(keymapEntryFor(rack, 38)?.sampleId).toBe('snare');
    expect(keymapEntryFor(rack, 40)).toBeUndefined();
  });
  it('a later pad overrides an earlier broad range', () => {
    const mixed: KeymapEntry[] = [...melodic, { sampleId: 'fx', rootNote: 60, loNote: 60, hiNote: 60 }];
    expect(keymapEntryFor(mixed, 60)?.sampleId).toBe('fx');   // last match wins
    expect(keymapEntryFor(mixed, 61)?.sampleId).toBe('lead');
  });
});

describe('repitchRate', () => {
  it('plays at unity on the root note', () => {
    expect(repitchRate(60, 60)).toBeCloseTo(1, 6);
  });
  it('an octave up doubles the rate', () => {
    expect(repitchRate(72, 60)).toBeCloseTo(2, 6);
  });
  it('applies a global pitch offset in semitones', () => {
    expect(repitchRate(60, 60, 12)).toBeCloseTo(2, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/keymap.test.ts`
Expected: FAIL — module `./keymap` not found.

- [ ] **Step 3: Write the implementation**

Create `src/samples/keymap.ts`:

```ts
// src/samples/keymap.ts
// Pure keymap resolution + repitch math. No audio, no DOM.

import type { KeymapEntry } from './types';

/** The entry that should play for `midi`. Last matching entry wins, so a
 *  single-note pad added after a broad melodic range overrides it on that
 *  note. Returns undefined when nothing covers the note. */
export function keymapEntryFor(keymap: KeymapEntry[], midi: number): KeymapEntry | undefined {
  let found: KeymapEntry | undefined;
  for (const e of keymap) {
    if (midi >= e.loNote && midi <= e.hiNote) found = e;
  }
  return found;
}

/** Playback rate for a one-shot: equal-temperament repitch from the root,
 *  plus an optional global pitch offset (semitones). */
export function repitchRate(midi: number, rootNote: number, pitchSemitones = 0): number {
  return Math.pow(2, (midi - rootNote + pitchSemitones) / 12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/keymap.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/samples/keymap.ts src/samples/keymap.test.ts
git commit -m "feat(samples): pure keymap resolution + repitch"
```

---

## Task 6: SamplerEngine skeleton (params + registry)

**Files:**
- Create: `src/engines/sampler.ts`
- Test: `src/engines/sampler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engines/sampler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SamplerEngine } from './sampler';
import { createEngineInstance } from './registry';

describe('SamplerEngine — metadata', () => {
  it('declares the expected identity + params', () => {
    const e = new SamplerEngine();
    expect(e.id).toBe('sampler');
    expect(e.type).toBe('polyhost');
    expect(e.polyphony).toBe('poly');
    const ids = e.params.map((p) => p.id);
    expect(ids).toEqual([
      'gain', 'amp.attack', 'amp.release', 'pitch',
      'filter.cutoff', 'filter.resonance', 'poly.voices',
    ]);
  });

  it('filter.cutoff defaults to fully open (1)', () => {
    expect(new SamplerEngine().getBaseValue('filter.cutoff')).toBe(1);
  });

  it('get/setBaseValue round-trips a param', () => {
    const e = new SamplerEngine();
    e.setBaseValue('amp.attack', 0.25);
    expect(e.getBaseValue('amp.attack')).toBe(0.25);
  });

  it('is registered as a factory engine', () => {
    const inst = createEngineInstance('sampler');
    expect(inst?.id).toBe('sampler');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler.test.ts`
Expected: FAIL — module `./sampler` not found.

- [ ] **Step 3: Write the engine skeleton (no playback yet)**

Create `src/engines/sampler.ts`:

```ts
// src/engines/sampler.ts
// Sampler engine: plays one-shot samples pitched per MIDI note. Phase 2 of the
// sampler spec (loop/song clip playback, modulation wiring, voice-stealing and
// the keymap UI arrive in later plans). The voice is built in Task 7.

import type {
  SynthEngine, Voice, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { KeymapEntry } from '../samples/types';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',             label: 'Gain',    kind: 'continuous', min: 0,     max: 1.5, default: 1 },
  { id: 'amp.attack',       label: 'Attack',  kind: 'continuous', min: 0.001, max: 2,   default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'amp.release',      label: 'Release', kind: 'continuous', min: 0.005, max: 4,   default: 0.08,  unit: 's', curve: 'exponential' },
  { id: 'pitch',            label: 'Pitch',   kind: 'continuous', min: -24,   max: 24,  default: 0,     unit: 'st' },
  { id: 'filter.cutoff',    label: 'Cutoff',  kind: 'continuous', min: 0,     max: 1,   default: 1 },
  { id: 'filter.resonance', label: 'Res',     kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { id: 'poly.voices',      label: 'Voices',  kind: 'continuous', min: 1,     max: 16,  default: 8 },
];

class SamplerSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

export class SamplerEngine implements SynthEngine {
  readonly id = 'sampler';
  readonly name = 'Sampler';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SAMPLER_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  private paramValues: Record<string, number> = {};
  private keymap: KeymapEntry[] = [];
  private modHost = new ModulationHostImpl([]);

  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }
  setBaseValue(id: string, v: number): void {
    this.paramValues[id] = v;
  }

  /** Replace the lane's one-shot keymap. Phase-3 UI calls this; tests call it
   *  directly. */
  setKeymap(entries: KeymapEntry[]): void {
    this.keymap = entries;
  }
  getKeymap(): KeymapEntry[] {
    return this.keymap;
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    for (const [k, v] of Object.entries(p.params)) this.paramValues[k] = v;
  }

  // createVoice is implemented in Task 7.
  createVoice(_ctx: AudioContext, _output: AudioNode): Voice {
    throw new Error('SamplerEngine.createVoice not implemented yet');
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new SamplerSequencer(); }
  buildParamUI(_c: HTMLElement, _ctx?: EngineUIContext): void { /* keymap UI: later plan */ }
  dispose(): void { this.keymap = []; }
}

export const samplerEngine = new SamplerEngine();
registerEngine(samplerEngine);
registerEngineFactory('sampler', () => new SamplerEngine());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler.test.ts
git commit -m "feat(sampler): engine skeleton — params + registry"
```

---

## Task 7: SamplerVoice one-shot playback (DSP)

**Files:**
- Modify: `src/engines/sampler.ts` (implement `createVoice` + `SamplerVoice`)
- Test: `src/engines/sampler.dsp.test.ts`

- [ ] **Step 1: Write the failing DSP test**

Create `src/engines/sampler.dsp.test.ts`:

```ts
// src/engines/sampler.dsp.test.ts
// Layer-3 real-DSP tests for the Sampler engine. A synthetic harmonic-rich
// buffer is created inside the SAME OfflineAudioContext as the render and put
// into the cache, so the engine resolves and plays it. Assertions are relative.

import { describe, it, expect, beforeEach } from 'vitest';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';
import { rms, peak, isSilent, spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

const SR = 44100;
const ROOT = 48;

/** Render one or more sampler triggers. The synthetic source is a sum of the
 *  first 8 harmonics of `fundHz` (rich enough for repitch + filter to move the
 *  spectral centroid). */
async function renderSampler(opts: {
  fundHz?: number;
  setup?: (e: SamplerEngine) => void;
  act: (voice: import('./engine-types').Voice) => void;
  durationSec: number;
}): Promise<Float32Array> {
  const fundHz = opts.fundHz ?? 110;
  const ctx = new OfflineAudioContext(1, Math.round(opts.durationSec * SR), SR);

  const len = Math.round(0.5 * SR);
  const buf = ctx.createBuffer(1, len, SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * fundHz * h * i / SR) / h;
    data[i] = s * 0.2;
  }
  sampleCache.put('test', buf);

  const engine = new SamplerEngine();
  engine.setKeymap([{ sampleId: 'test', rootNote: ROOT, loNote: 0, hiNote: 127 }]);
  opts.setup?.(engine);

  const out = ctx.createGain();
  const voice = engine.createVoice(ctx as unknown as AudioContext, out);
  out.connect(ctx.destination);
  opts.act(voice);

  const rendered = await ctx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

describe('SamplerEngine — one-shot DSP', () => {
  beforeEach(() => sampleCache.clear());

  it('produces audible sound when triggered on the root note', async () => {
    const buf = await renderSampler({
      durationSec: 0.4,
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    writeWav(buf, wavPath('sampler__sounds'), SR);
    expect(isSilent(buf)).toBe(false);
    expect(peak(buf)).toBeGreaterThan(0.01);
  });

  it('is silent when no keymap entry covers the note', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(0.2 * SR), SR);
    const engine = new SamplerEngine();
    engine.setKeymap([{ sampleId: 'test', rootNote: ROOT, loNote: ROOT, hiNote: ROOT }]);
    const out = ctx.createGain();
    const voice = engine.createVoice(ctx as unknown as AudioContext, out);
    out.connect(ctx.destination);
    voice.trigger(ROOT + 7, 0, { gateDuration: 0.1 }); // outside range, no cache entry either
    const rendered = await ctx.startRendering();
    expect(isSilent(new Float32Array(rendered.getChannelData(0)))).toBe(true);
  });

  it('an octave up raises the spectral centroid', async () => {
    const low = await renderSampler({
      durationSec: 0.4,
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    const high = await renderSampler({
      durationSec: 0.4,
      act: (v) => v.trigger(ROOT + 12, 0, { gateDuration: 0.3 }),
    });
    writeWav(low,  wavPath('sampler__pitch-root'), SR);
    writeWav(high, wavPath('sampler__pitch-oct'),  SR);
    expect(spectralCentroid(high, SR)).toBeGreaterThan(spectralCentroid(low, SR) * 1.5);
  });

  it('opening the cutoff raises the spectral centroid', async () => {
    const dark = await renderSampler({
      durationSec: 0.4,
      setup: (e) => e.setBaseValue('filter.cutoff', 0.1),
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    const bright = await renderSampler({
      durationSec: 0.4,
      setup: (e) => e.setBaseValue('filter.cutoff', 0.95),
      act: (v) => v.trigger(ROOT, 0, { gateDuration: 0.3 }),
    });
    writeWav(dark,   wavPath('sampler__cutoff-low'), SR);
    writeWav(bright, wavPath('sampler__cutoff-hi'),  SR);
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });

  it('release cuts the gate', async () => {
    const buf = await renderSampler({
      durationSec: 1.0,
      act: (v) => { v.trigger(ROOT, 0, { gateDuration: 1.0 }); v.release(0.1); },
    });
    writeWav(buf, wavPath('sampler__release'), SR);
    const head = buf.subarray(0, Math.round(0.1 * SR));
    const tail = buf.subarray(buf.length - Math.round(0.05 * SR));
    expect(rms(tail)).toBeLessThan(rms(head) * 0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler.dsp.test.ts`
Expected: FAIL — `createVoice not implemented yet`.

- [ ] **Step 3: Implement `SamplerVoice` + `createVoice`**

In `src/engines/sampler.ts`, add these imports to the existing import block:

```ts
import type { VoiceTriggerOptions } from './engine-types';
import { sampleCache } from '../samples/sample-cache';
import { keymapEntryFor, repitchRate } from '../samples/keymap';
```

Add the `SamplerVoice` class above the `SamplerEngine` class:

```ts
const OUTPUT_TRIM = 0.7; // headroom so a full-scale sample + resonance stays < 0 dBFS

class SamplerVoice implements Voice {
  private src: AudioBufferSourceNode | null = null;
  private readonly filter: BiquadFilterNode;
  private readonly ampGain: GainNode;
  private started = false;
  private endTime = Infinity;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private keymap: KeymapEntry[],
    private getParam: (id: string) => number,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();
    this.ampGain.gain.value = 0;
    this.filter.connect(this.ampGain).connect(output);
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const entry = keymapEntryFor(this.keymap, midi);
    if (!entry) return;
    const buf = sampleCache.get(entry.sampleId);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = repitchRate(midi, entry.rootNote, this.getParam('pitch'));
    src.connect(this.filter);
    this.src = src;

    // Static lowpass: cutoff knob 0..1 → 60..18000 Hz (exp), open by default.
    const cutoff = this.getParam('filter.cutoff');
    const res = this.getParam('filter.resonance');
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);

    // Amp envelope: attack → hold at peak until gate end → release to 0.
    const peakLevel =
      this.getParam('gain') * (entry.gain ?? 1) * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM;
    const atk = Math.max(0.001, this.getParam('amp.attack'));
    const rel = Math.max(0.005, this.getParam('amp.release'));
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peakLevel, time + atk);
    const releaseAt = Math.max(time + atk, time + opts.gateDuration);
    g.setValueAtTime(peakLevel, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

    this.endTime = releaseAt + rel + 0.01;
    src.start(time, 0);
    src.stop(this.endTime);
    this.started = true;
  }

  release(time: number): void {
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + 0.005); // gate cut, not a musical release
    if (this.src && this.started && time + 0.02 < this.endTime) {
      try { this.src.stop(time + 0.02); } catch { /* already stopped */ }
    }
  }

  connect(_dest: AudioNode): void { /* already connected to output */ }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['amp.gain',         this.ampGain.gain],
      ['filter.cutoff',    this.filter.frequency],
      ['filter.resonance', this.filter.Q],
    ]);
  }

  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.filter.disconnect();
    this.ampGain.disconnect();
  }
}
```

Replace the placeholder `createVoice` in `SamplerEngine` with:

```ts
  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new SamplerVoice(ctx, output, this.keymap, (id) => this.getBaseValue(id));
  }
```

- [ ] **Step 4: Run the DSP test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler.dsp.test.ts`
Expected: PASS (5 tests). WAVs written to `test/output/sampler__*.wav` for audible inspection.

- [ ] **Step 5: Run the full unit suite + typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test:unit`
Expected: all suites pass, including the new `src/samples/*` and `src/engines/sampler*` files.

- [ ] **Step 6: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler.dsp.test.ts
git commit -m "feat(sampler): one-shot voice playback (repitch + LP + amp env)"
```

---

## Self-Review

**1. Spec coverage (Phases 1–2 only — Phases 3–6 are explicitly out of this plan):**
- Sample asset + IndexedDB store + decoded cache → Tasks 1, 3, 4 ✓
- Import metadata → Task 2 ✓
- Keymap data type + resolution (melodic + rack) → Tasks 1, 5 ✓
- Repitch math (`region`/`clip` is loop-only; one-shot `2^((midi-root)/12)`) → Task 5 ✓
- `SamplerEngine` implementing `SynthEngine`, registered, per-voice LP open by default, amp envelope, missing-sample = silent → Tasks 6, 7 ✓
- DSP verification (audible, repitch, cutoff, release, silent-on-miss) → Task 7 ✓
- Deferred and called out: loading UI/keymap editor (Phase 3), loop/song clips + scheduler (Phase 4), session persistence/hydration + missing-sample relink UI (Phase 5), polish + voice-stealing + modulation-host→voice wiring (Phase 6). These are future plans, not gaps in this plan.

**2. Placeholder scan:** No "TBD"/"add error handling"/vague steps. The only deferred method (`createVoice`) is an explicit `throw` in Task 6 that Task 7 replaces — and Task 6's test does not call it, so the suite is green at every commit. ✓

**3. Type consistency:** `SampleAsset`, `KeymapEntry`, `SampleStore` defined in Task 1 and used unchanged in Tasks 2–7. `keymapEntryFor(keymap, midi)` and `repitchRate(midi, root, pitch?)` defined in Task 5 and called with matching signatures in Task 7. `sampleCache.put/get/has/clear/ensureLoaded` defined in Task 3 and used in Task 7's test. Engine param ids in Task 6 (`gain`, `amp.attack`, `amp.release`, `pitch`, `filter.cutoff`, `filter.resonance`, `poly.voices`) match those read in Task 7's voice. ✓

---

## Next plans in the series

- **Plan 2 — Loading & keymap UI (Phase 3):** drag-drop + file picker, `importFile` wired to store+cache, keymap editor in `buildParamUI`, lane creation with the `sampler` engine. Verified via Playwright e2e (`tests/e2e/`).
- **Plan 3 — Loop/song clips (Phase 4):** `ClipSample`/`SessionClip.sample`, waveform clip editor + router, `tickLane` `clip.sample` branch, `VoiceTriggerOptions.sample`, loop repitch = region/clip, song ×1, micro-fades. Scheduling + DSP tests.
- **Plan 4 — Persistence, hydration & polish (Phases 5–6):** session save references, hydrate from IndexedDB on load, missing-sample relink, grid waveform thumbnail, voice-stealing/poly-cap, modulation-host→voice wiring.
