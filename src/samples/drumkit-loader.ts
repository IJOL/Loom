// src/samples/drumkit-loader.ts
// Loads a bundled sample drumkit (public/drumkits/<id>.json + its wavs) into a
// sampler keymap. A kit is just many single-note keymap entries, one per voice,
// each pinned to its General-MIDI drum note — so the existing drum-grid editor
// (which writes NoteEvent{midi: VOICE_MIDI[voice]}) drives it with no changes.
//
// We never persist the resolved sampleIds for a kit: loadDrumkit generates fresh
// ids every call and is re-run from the manifest id on session/demo load. That
// sidesteps the in-memory-only sample cache (which is never serialised) — the
// kit is self-healing across reloads.

import type { KeymapEntry, SampleAsset } from './types';
import { sampleStore } from './store-singleton';
import { sampleCache } from './sample-cache';
import { buildSampleAsset, newSampleId } from './import';

/** One pad of a drumkit: a sample file mapped to a single GM drum note. */
export interface DrumkitSample {
  voice: string; // 'kick' | 'snare' | ... — display/debug only; note is authoritative
  note: number; // GM midi note this pad triggers on (e.g. kick=36)
  file: string; // path under public/drumkits/, e.g. 'tr808/kick.wav'
  gain?: number; // optional linear gain
  root?: number; // sample's nominal pitch; repitch = note - root. Absent ⇒ native pitch.
}

/** A bundled kit: public/drumkits/<id>.json. */
export interface DrumkitManifest {
  id: string;
  name: string;
  samples: DrumkitSample[];
}

/** An entry in public/drumkits/index.json. */
export interface DrumkitIndexEntry {
  id: string;
  name: string;
}

/** Minimal seams so the impure loader is unit-testable without a real
 *  AudioContext / IndexedDB / network. */
interface LoadDeps {
  store?: { put(asset: SampleAsset): Promise<void> };
  cache?: { put(id: string, buf: AudioBuffer): void };
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** PURE: build a single-note keymap from a kit's samples and the sampleId
 *  assigned to each (same order). Each entry is a drum pad pinned to its GM
 *  note: loNote === hiNote === rootNote === note. */
export function buildDrumkitKeymap(samples: DrumkitSample[], sampleIds: string[]): KeymapEntry[] {
  if (samples.length !== sampleIds.length) {
    throw new Error(`drumkit keymap: ${samples.length} samples but ${sampleIds.length} ids`);
  }
  return samples.map((s, i) => ({
    sampleId: sampleIds[i],
    rootNote: s.root ?? s.note,
    loNote: s.note,
    hiNote: s.note,
    ...(s.gain != null ? { gain: s.gain } : {}),
  }));
}

/** Read the bundled kit index. Returns [] if it is missing or unreachable. */
export async function listDrumkits(fetchFn: typeof fetch = fetch): Promise<DrumkitIndexEntry[]> {
  // Base-aware so it resolves under the deploy sub-path (GitHub Pages `/Loom/`);
  // BASE_URL is `/` in dev + the standard build. The try/catch honours the
  // "returns [] if missing" contract: a thrown fetch (e.g. the relative URL has
  // no base in node tests, or the browser is offline) yields [] rather than an
  // unhandled rejection from the fire-and-forget caller in buildParamUI.
  try {
    const res = await fetchFn(`${import.meta.env.BASE_URL}drumkits/index.json`);
    if (!res.ok) return [];
    return (await res.json()) as DrumkitIndexEntry[];
  } catch {
    return [];
  }
}

/** Read one kit manifest by id. */
export async function fetchDrumkitManifest(id: string, fetchFn: typeof fetch = fetch): Promise<DrumkitManifest> {
  const res = await fetchFn(`${import.meta.env.BASE_URL}drumkits/${id}.json`);
  if (!res.ok) throw new Error(`drumkit '${id}' manifest not found (${res.status})`);
  return (await res.json()) as DrumkitManifest;
}

/** IMPURE: fetch every voice's wav, decode it, persist to the sample store +
 *  decoded cache, and return a fresh single-note keymap. */
export async function loadDrumkit(
  manifest: DrumkitManifest,
  ctx: AudioContext,
  deps: LoadDeps = {},
): Promise<KeymapEntry[]> {
  const store = deps.store ?? sampleStore;
  const cache = deps.cache ?? sampleCache;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;

  const ids: string[] = [];
  for (const s of manifest.samples) {
    const res = await fetchFn(`${import.meta.env.BASE_URL}drumkits/${s.file}`);
    const bytes = await res.arrayBuffer();
    // decodeAudioData detaches its input — decode a copy, keep the original bytes.
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    const id = newSampleId();
    await store.put(buildSampleAsset({ id, name: s.file, mime: 'audio/wav', bytes, buffer, createdAt: now() }));
    cache.put(id, buffer);
    ids.push(id);
  }
  return buildDrumkitKeymap(manifest.samples, ids);
}
