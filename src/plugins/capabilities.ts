// The ONE door through which the core asks what a component can do. Every
// `engineId === '…'` left outside this file is a bug.
//
// Two sources, and the caller cannot tell which: a built-in component registers
// from code, a plugin one from its manifest. Migrating an engine in slice 3
// moves its answer from one source to the other WITHOUT touching the core.
import type { EngineCapabilities, GmHint } from '@loom/plugin-sdk';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';

const caps = new Map<string, EngineCapabilities>();
/** Ids that arrived through a plugin manifest. Kept apart from the map because
 *  "is a plugin" is NOT a capability: it is how the thing was loaded. */
const fromPlugin = new Set<string>();

export function registerEngineCapabilities(id: string, c: EngineCapabilities, isPlugin = false): void {
  caps.set(id, c);
  if (isPlugin) fromPlugin.add(id);
}

export function engineCapabilities(id: string): EngineCapabilities | undefined {
  return caps.get(id);
}

// ── Named accessors ────────────────────────────────────────────────────────
// An unknown id answers like an ordinary melodic instrument. NEVER undefined: an
// engine not yet registered would blank out its lane's UI, and that failure is
// silent. The safe default is "normal".

export function clipContentOf(id: string): 'notes' | 'audio' {
  return caps.get(id)?.clipContent ?? 'notes';
}
export function isAudioEngine(id: string): boolean {
  return clipContentOf(id) === 'audio';
}
export function defaultNoteViewOf(id: string): 'pitches' | 'pads' {
  return caps.get(id)?.defaultNoteView ?? 'pitches';
}
export function acceptsAudioFile(id: string): boolean {
  return caps.get(id)?.accepts?.includes('audio-file') ?? false;
}
export function acceptsNoteFx(id: string): boolean {
  return caps.get(id)?.acceptsNoteFx ?? true;
}
export function isHarmonic(id: string): boolean {
  return caps.get(id)?.harmonic ?? true;
}
export function isListedInSelector(id: string): boolean {
  return caps.get(id)?.listedInSelector ?? true;
}
export function isRandomizable(id: string): boolean {
  return caps.get(id)?.isRandomizable ?? true;
}
export function shortLabelFor(id: string): string | undefined {
  return caps.get(id)?.shortLabel;
}

/** A plugin component synthesises in the worklet exactly when it arrived by
 *  manifest: its renderer ships in the same bundle. */
export function isWorkletHosted(id: string): boolean {
  return fromPlugin.has(id);
}

/** What the host must multiply a PLUGIN engine's voices by: its declared
 *  balance times the category gain — exactly what synthTrim() computes for an
 *  in-tree engine. undefined when it is not a plugin, so callers fall back to 1
 *  and the in-tree renderer's own multiplication still stands. */
export function pluginSynthTrim(id: string): number | undefined {
  if (!fromPlugin.has(id)) return undefined;
  const t = caps.get(id)?.outputTrim;
  return t === undefined ? undefined : t * CATEGORY_GAIN.synth;
}

export function pluginGmHints(): { keywords: string[]; engineId: string; priority: number }[] {
  const out: { keywords: string[]; engineId: string; priority: number }[] = [];
  for (const id of fromPlugin) {
    const gm: GmHint | undefined = caps.get(id)?.gm;
    if (gm) out.push({ keywords: gm.keywords, engineId: id, priority: gm.priority });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** Test-only. */
export function __resetCapabilities(): void { caps.clear(); fromPlugin.clear(); }
