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
// This file (Task 3) defines the manifest types and the PURE keymap builder.
// The impure list/fetch/load helpers land in the following tasks.

import type { KeymapEntry } from './types';
import type { PadParams } from '../engines/sampler-pad-params';
import type { ResolutionKey } from '../core/drum-grid-editing';

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
