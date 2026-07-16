// SPDX-License-Identifier: AGPL-3.0-or-later
// The pattern library as the UI needs it: pick a style, get a named list; pick
// one, get NoteEvents.
//
// The patterns are mpump's (AGPL-3.0-or-later) — see public/patterns/ATTRIBUTION.md.
// Their genre keys are our StyleId verbatim, so a lookup is `patterns[style]`
// with no translation table to drift.

import { snapToScale, type StyleId, type ScaleId } from '../core/musicality';
import type { NoteEvent } from '../core/notes';
import {
  drumPatternToNotes, melodicPatternToNotes,
  type MpumpDrumPattern, type MpumpMelodicPattern,
} from './mpump-patterns';

export type PatternKind = 'drums' | 'bass' | 'synth';

/** One entry as the dropdown shows it. `index` is its position in the style's
 *  pattern array — what patternNotes() takes. */
export interface PatternEntry {
  index: number;
  name: string;
  desc: string;
}

interface CatalogGenre { name: string; patterns: { name: string; desc: string }[] }
interface RawCatalog {
  s1?: { genres?: CatalogGenre[] };
  t8?: { drum_genres?: CatalogGenre[]; bass_genres?: CatalogGenre[] };
}

export interface RawLibrary {
  synth: Record<string, MpumpMelodicPattern[]>;
  drums: Record<string, MpumpDrumPattern[]>;
  bass: Record<string, MpumpMelodicPattern[]>;
  catalog: RawCatalog;
}

let lib: RawLibrary | null = null;

/** Install the library (from fetch at boot, or read off disk in tests). */
export function setLibrary(next: RawLibrary): void { lib = next; }

/** Fetch + install the library. Safe to call more than once. */
export async function loadLibrary(baseUrl = '/'): Promise<void> {
  if (lib) return;
  const get = (f: string) => fetch(`${baseUrl}patterns/${f}`).then((r) => r.json());
  const [synth, drums, bass, catalog] = await Promise.all([
    get('patterns-s1.json'), get('patterns-t8-drums.json'),
    get('patterns-t8-bass.json'), get('catalog.json'),
  ]);
  setLibrary({ synth, drums, bass, catalog });
}

function pool(kind: PatternKind): Record<string, unknown[]> {
  if (!lib) return {};
  return (kind === 'drums' ? lib.drums : kind === 'bass' ? lib.bass : lib.synth) ?? {};
}

function catalogGenres(kind: PatternKind): CatalogGenre[] {
  if (!lib) return [];
  const c = lib.catalog;
  if (kind === 'drums') return c.t8?.drum_genres ?? [];
  if (kind === 'bass') return c.t8?.bass_genres ?? [];
  return c.s1?.genres ?? [];
}

/** Styles the library actually ships patterns for. */
export function stylesWithPatterns(): StyleId[] {
  return Object.keys(pool('drums')) as StyleId[];
}

/** The named patterns for a style, in library order — what the dropdown lists. */
export function patternsFor(style: StyleId, kind: PatternKind): PatternEntry[] {
  const patterns = pool(kind)[style] ?? [];
  const named = catalogGenres(kind).find((g) => g.name === style)?.patterns ?? [];
  return patterns.map((_, index) => ({
    index,
    // Fall back to the index only if the catalog and the data disagree; a
    // nameless entry is a bug worth seeing rather than hiding.
    name: named[index]?.name ?? `#${index + 1}`,
    desc: named[index]?.desc ?? '',
  }));
}

/** The picked pattern as playable notes.
 *
 *  `rootMidi` only matters for melodic kinds — drum patterns carry absolute GM
 *  notes. Unknown index → [].
 *
 *  Every pattern in the library is ONE bar, but a Loom clip is two by default,
 *  so pass `clipBars` + `barTicks` and the bar repeats to fill it. Without that
 *  the second half of the clip is silent — the pattern plays once and stops.
 *  Same convention as renderExampleNotes().
 *
 *  `snapTo` is the scale lock, and it is the ONLY thing allowed to alter the
 *  pattern. Omit it (lock open) and every note arrives exactly as its author
 *  wrote it: ~4% of the library's melodic notes sit outside a minor scale, and
 *  in acid those cromatismos ARE the line — "fixing" them would be vandalism.
 *  Pass it (lock closed) and pitches are pulled into the key. Drums are never
 *  snapped: a GM drum note picks a voice, it is not a pitch. */
export function patternNotes(
  style: StyleId,
  kind: PatternKind,
  index: number,
  rootMidi = 36,
  clipBars?: number,
  barTicks?: number,
  snapTo?: { key: number; scale: ScaleId },
): NoteEvent[] {
  const patterns = pool(kind)[style];
  const p = patterns?.[index];
  if (!p) return [];

  let once = kind === 'drums'
    ? drumPatternToNotes(p as MpumpDrumPattern)
    : melodicPatternToNotes(p as MpumpMelodicPattern, rootMidi);

  if (snapTo && kind !== 'drums') {
    once = once.map((n) => ({ ...n, midi: snapToScale(n.midi, snapTo.key, snapTo.scale) }));
  }

  if (!clipBars || !barTicks || clipBars <= 1 || once.length === 0) return once;

  const out: NoteEvent[] = [];
  const clipEnd = clipBars * barTicks;
  for (let bar = 0; bar < clipBars; bar++) {
    const offset = bar * barTicks;
    for (const n of once) {
      const start = n.start + offset;
      if (start >= clipEnd) continue;
      // A note may hang past the clip end (a slide on the last step does).
      out.push({ ...n, start, duration: Math.min(n.duration, clipEnd - start) });
    }
  }
  return out;
}
