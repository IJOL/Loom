// src/samples/keymap-edit.ts
// Pure, immutable edits to a one-shot keymap. No DOM, no audio.
import type { KeymapEntry } from './types';

const clampNote = (n: number) => Math.max(0, Math.min(127, Math.round(n)));

/** Append a sample as a melodic full-range entry (root C3 by default). */
export function addSampleToKeymap(
  keymap: KeymapEntry[],
  sampleId: string,
  opts: { rootNote?: number } = {},
): KeymapEntry[] {
  const rootNote = clampNote(opts.rootNote ?? 60);
  return [...keymap, { sampleId, rootNote, loNote: 0, hiNote: 127 }];
}

export function removeKeymapEntry(keymap: KeymapEntry[], index: number): KeymapEntry[] {
  return keymap.filter((_, i) => i !== index);
}

export function setEntryRoot(keymap: KeymapEntry[], index: number, rootNote: number): KeymapEntry[] {
  return keymap.map((e, i) => (i === index ? { ...e, rootNote: clampNote(rootNote) } : e));
}

export function setEntryRange(keymap: KeymapEntry[], index: number, lo: number, hi: number): KeymapEntry[] {
  let loN = clampNote(lo);
  let hiN = clampNote(hi);
  if (loN > hiN) [loN, hiN] = [hiN, loN];
  return keymap.map((e, i) => (i === index ? { ...e, loNote: loN, hiNote: hiN } : e));
}
