// src/samples/instrument-loader.ts
// Loads a bundled sample instrument (public/instruments/<id>.json + its wavs)
// into a sampler keymap. Sibling of drumkit-loader.ts: same self-healing model
// (fresh sampleIds every load, re-run from the manifest id on session/demo load,
// IndexedDB-only cache never serialised), but for the Sampler's *melodic* and
// *loop* preset families rather than GM drum pads.
//
//   - Melodic: a multi-zone chromatic instrument. Each zone is a wav mapped over
//     a key range (loNote..hiNote) at a root note; `keymapEntryFor` resolves
//     overlaps "last match wins".
//   - Loop: a single loop wav carved into slices at FIXED slicePointsSec, mapped
//     one note per slice from SLICE_BASE_NOTE (the bank); the note clip + scene
//     that play it are materialised by SessionHost, not here.
//
// This file defines the manifest types, the PURE keymap builder, and the
// index/manifest fetch helpers (same contract as drumkit-loader). The impure
// loadInstrument helper lands in the following tasks.

import type { KeymapEntry, SampleAsset } from './types';
import type { PadParams } from '../engines/sampler-pad-params';
import type { ResolutionKey } from '../core/drum-grid-editing';
import { sampleStore } from './store-singleton';
import { sampleCache } from './sample-cache';
import { buildSampleAsset, newSampleId } from './import';
import { sliceBuffer } from './slice-buffer';
import { slicesToKeymap, audioBufferToWavBytes } from './slice-to-bank';
import { detectLoop } from './loop-analysis';
import { DEFAULT_METER } from '../core/meter';

/** One melodic zone: a wav mapped over a key range at a root note. */
export interface MelodicZone {
  file: string;     // path under public/instruments/, e.g. 'sweep-pad/low.wav'
  rootNote: number; // midi at which the sample plays at natural pitch
  loNote: number;   // inclusive key-range low
  hiNote: number;   // inclusive key-range high
  gain?: number;    // optional linear gain
}

/** A bundled melodic instrument: public/instruments/<id>.json (family 'melodic'). */
export interface MelodicInstrumentManifest {
  id: string;
  name: string;
  family: 'melodic';
  zones: MelodicZone[];
  // Per-pad/zone params (same leaves as PadParams), keyed by rootNote. The
  // persisted chain uses Record<number, Record<string, number>>; the caller
  // casts when handing this to setPadStore/mirrorPadParams (see spec §nota de tipos).
  padParams?: Record<number, Partial<PadParams>>;
}

/** A bundled loop instrument: public/instruments/<id>.json (family 'loop'). */
export interface LoopInstrumentManifest {
  id: string;
  name: string;
  family: 'loop';
  file: string;             // the whole-loop wav (a single file)
  originalBpm: number;
  slicePointsSec: number[]; // FIXED cuts (note↔slice determinism)
  gridResolution?: ResolutionKey;
}

/** Either family of bundled Sampler instrument. */
export type InstrumentManifest = MelodicInstrumentManifest | LoopInstrumentManifest;

/** An entry in public/instruments/index.json. Drumkits stay in public/drumkits/. */
export interface InstrumentIndexEntry {
  id: string;
  name: string;
  family: 'melodic' | 'loop';
}

/** What a loaded melodic instrument hands back: a fresh keymap plus any
 *  per-zone params the manifest carried (the caller casts + feeds them to
 *  setPadStore/mirrorPadParams). */
export interface LoadedMelodicInstrument {
  keymap: KeymapEntry[];
  padParams?: Record<number, Partial<PadParams>>;
}

/** What a loaded loop instrument hands back: the slice bank as a mono-note
 *  keymap plus the loop metadata SessionHost needs to build the note clip +
 *  scene (buildSliceClip + installSamplerClip live there, not here — the loader
 *  never touches SessionState). slicePointsSec mirrors the manifest's fixed cuts
 *  so the note↔slice mapping is deterministic across reloads. */
export interface LoadedLoopInstrument {
  keymap: KeymapEntry[];
  slicePointsSec: number[];
  durationSec: number;
  originalBpm: number;
}

/** Minimal seams so the impure loader is unit-testable without a real
 *  AudioContext / IndexedDB / network. Mirror of drumkit-loader's LoadDeps. */
interface LoadDeps {
  store?: { put(asset: SampleAsset): Promise<void> };
  cache?: { put(id: string, buf: AudioBuffer): void };
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** PURE: build a multi-zone melodic keymap from a manifest's zones and the
 *  sampleId assigned to each (same order). One entry per zone carrying its
 *  rootNote/loNote/hiNote (+ gain when present). Mirror of buildDrumkitKeymap;
 *  throws on a zones/ids length mismatch. */
export function buildMelodicKeymap(zones: MelodicZone[], sampleIds: string[]): KeymapEntry[] {
  if (zones.length !== sampleIds.length) {
    throw new Error(`melodic keymap: ${zones.length} zones but ${sampleIds.length} ids`);
  }
  return zones.map((z, i) => ({
    sampleId: sampleIds[i],
    rootNote: z.rootNote,
    loNote: z.loNote,
    hiNote: z.hiNote,
    ...(z.gain != null ? { gain: z.gain } : {}),
  }));
}

/** Read the bundled instrument index. Returns [] if it is missing or
 *  unreachable (same contract as listDrumkits): a thrown fetch (offline, or the
 *  relative URL has no base in node tests) yields [] rather than an unhandled
 *  rejection from the fire-and-forget caller in buildParamUI. Base-aware so it
 *  resolves under the deploy sub-path (GitHub Pages `/Loom/`). */
export async function listInstruments(fetchFn: typeof fetch = fetch): Promise<InstrumentIndexEntry[]> {
  try {
    const res = await fetchFn(`${import.meta.env.BASE_URL}instruments/index.json`);
    if (!res.ok) return [];
    return (await res.json()) as InstrumentIndexEntry[];
  } catch {
    return [];
  }
}

/** Read one instrument manifest by id. Throws if the manifest is missing
 *  (mirror of fetchDrumkitManifest). */
export async function fetchInstrumentManifest(id: string, fetchFn: typeof fetch = fetch): Promise<InstrumentManifest> {
  const res = await fetchFn(`${import.meta.env.BASE_URL}instruments/${id}.json`);
  if (!res.ok) throw new Error(`instrument '${id}' manifest not found (${res.status})`);
  return (await res.json()) as InstrumentManifest;
}

/** IMPURE: load a bundled Sampler instrument. Dispatches on the manifest
 *  family — melodic → a multi-zone chromatic keymap, loop → a slice bank +
 *  the loop metadata. Both are self-healing: fresh sampleIds every call,
 *  IndexedDB-only cache (mirror of loadDrumkit). The overloads keep the return
 *  type precise per family. */
export function loadInstrument(manifest: MelodicInstrumentManifest, ctx: AudioContext, deps?: LoadDeps): Promise<LoadedMelodicInstrument>;
export function loadInstrument(manifest: LoopInstrumentManifest, ctx: AudioContext, deps?: LoadDeps): Promise<LoadedLoopInstrument>;
export function loadInstrument(manifest: InstrumentManifest, ctx: AudioContext, deps?: LoadDeps): Promise<LoadedMelodicInstrument | LoadedLoopInstrument>;
export function loadInstrument(
  manifest: InstrumentManifest,
  ctx: AudioContext,
  deps: LoadDeps = {},
): Promise<LoadedMelodicInstrument | LoadedLoopInstrument> {
  return manifest.family === 'loop'
    ? loadLoopInstrument(manifest, ctx, deps)
    : loadMelodicInstrument(manifest, ctx, deps);
}

/** Melodic family: fetch every zone's wav, decode it, persist to the sample
 *  store + decoded cache with a fresh id, and return a multi-zone keymap plus
 *  any per-zone params the manifest declared. */
async function loadMelodicInstrument(
  manifest: MelodicInstrumentManifest,
  ctx: AudioContext,
  deps: LoadDeps,
): Promise<LoadedMelodicInstrument> {
  const store = deps.store ?? sampleStore;
  const cache = deps.cache ?? sampleCache;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;

  const ids: string[] = [];
  for (const z of manifest.zones) {
    const res = await fetchFn(`${import.meta.env.BASE_URL}instruments/${z.file}`);
    const bytes = await res.arrayBuffer();
    // decodeAudioData detaches its input — decode a copy, keep the original bytes.
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    const id = newSampleId();
    await store.put(buildSampleAsset({ id, name: z.file, mime: 'audio/wav', bytes, buffer, createdAt: now() }));
    cache.put(id, buffer);
    ids.push(id);
  }
  return { keymap: buildMelodicKeymap(manifest.zones, ids), padParams: manifest.padParams };
}

/** Loop family: fetch + decode the single loop wav, carve it at the manifest's
 *  FIXED slicePointsSec (re-derive with detectLoop only if the manifest left
 *  them empty), persist each slice as a fresh bank sample, and return the slice
 *  bank as a mono-note keymap (one consecutive note per slice from
 *  SLICE_BASE_NOTE) plus the loop metadata. buildSliceClip + clip/scene
 *  insertion happen in SessionHost — the loader never touches SessionState.
 *
 *  Determinism: the same slicePointsSec ⇒ the same slice order ⇒
 *  keymap[i].rootNote === SLICE_BASE_NOTE + i, matching buildSliceClip's
 *  notes[i].midi for the identical onsets. */
async function loadLoopInstrument(
  manifest: LoopInstrumentManifest,
  ctx: AudioContext,
  deps: LoadDeps,
): Promise<LoadedLoopInstrument> {
  const store = deps.store ?? sampleStore;
  const cache = deps.cache ?? sampleCache;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;

  const res = await fetchFn(`${import.meta.env.BASE_URL}instruments/${manifest.file}`);
  const bytes = await res.arrayBuffer();
  // decodeAudioData detaches its input — decode a copy (the whole-loop bytes are
  // re-persisted by SessionHost's reloadInstrument, not here).
  const buffer = await ctx.decodeAudioData(bytes.slice(0));

  // The manifest pins slicePointsSec for note↔slice determinism; only fall back
  // to detection if it left them empty.
  const slicePointsSec = manifest.slicePointsSec.length > 0
    ? manifest.slicePointsSec
    : detectLoop(buffer, DEFAULT_METER).slicePointsSec;

  const cuts = sliceBuffer(ctx, buffer, slicePointsSec);
  const ids: string[] = [];
  for (const cut of cuts) {
    const sliceBytes = await audioBufferToWavBytes(cut.buffer);
    const id = newSampleId();
    await store.put(buildSampleAsset({ id, name: `${manifest.id}/slice-${ids.length}.wav`, mime: 'audio/wav', bytes: sliceBytes, buffer: cut.buffer, createdAt: now() }));
    cache.put(id, cut.buffer);
    ids.push(id);
  }

  return {
    keymap: slicesToKeymap(ids),
    slicePointsSec,
    durationSec: buffer.duration,
    originalBpm: manifest.originalBpm,
  };
}
