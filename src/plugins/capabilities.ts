// The ONE door through which the core asks what a component can do. Every
// `engineId === '…'` left outside this file is a bug.
//
// Two sources, and the caller cannot tell which: a built-in component registers
// from code, a plugin one from its manifest. Migrating an engine in slice 3
// moves its answer from one source to the other WITHOUT touching the core.
import type { EngineCapabilities, GmHint, LaneRole } from '@loom/plugin-sdk';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';

const caps = new Map<string, EngineCapabilities>();
/** Ids that arrived through a plugin manifest. Kept apart from the map because
 *  "is a plugin" is NOT a capability: it is how the thing was loaded. */
const fromPlugin = new Set<string>();

export function registerEngineCapabilities(id: string, c: EngineCapabilities, isPlugin = false): void {
  caps.set(id, c);
  if (isPlugin) fromPlugin.add(id);
}

/** Reverses registerEngineCapabilities for one id — the rollback half of a
 *  plugin engine's registration. See registry.ts's unregisterEngine and
 *  plugin-host.ts. */
export function unregisterEngineCapabilities(id: string): void {
  caps.delete(id);
  fromPlugin.delete(id);
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
/** Read by the "🎲 Sound" dice: a lane whose engine declares false shows no dice
 *  at all, rather than a dead one. The lane editor asks through
 *  `session/lane-editor-panels.ts` and mounts it via
 *  `core/randomize-ui.ts mountRandomizeButton`.
 *  Default: true, so an instrument that says nothing gets its dice. */
export function isRandomizable(id: string): boolean {
  return caps.get(id)?.isRandomizable ?? true;
}
/** The part this ENGINE is built for, if it is built for one.
 *
 *  "The 303 is a bass machine" is a fact about the instrument, and it used to be
 *  written as `engineId === 'tb303'` in two different core files. It belongs
 *  here for the ordinary reason: the core may not know a plugin's name.
 *
 *  undefined is the honest answer for a general-purpose instrument, and it means
 *  its lanes stay unmarked — every melodic shelf offered, exactly as before.
 *  Read through `laneRoleOf`, which lets the user's mark overrule it. */
export function defaultRoleOf(id: string): LaneRole | undefined {
  return caps.get(id)?.defaultRole;
}
/** True when this engine's presets are KITS, not knob values.
 *
 *  The drum machine's case, and the reason it needs saying rather than being
 *  read off the id: a kit lane's list comes from the unified Synth/Samples
 *  catalogue and applying one rebuilds the editor. Default false — an ordinary
 *  instrument's preset is a bag of params. */
export function usesKitPresets(id: string): boolean {
  return caps.get(id)?.presetKind === 'kits';
}
export function shortLabelFor(id: string): string | undefined {
  return caps.get(id)?.shortLabel;
}
/** Whether an overlapping previous note makes this engine's note slide.
 *  Default false: an engine that says nothing never slides, which is what
 *  every engine but the 303 has always done. */
export function slidesOnOverlap(id: string): boolean {
  return caps.get(id)?.slide === 'overlap';
}

/** True for every engine that arrived through a plugin manifest — the ONLY
 *  thing this checks. It does NOT check whether the plugin actually shipped a
 *  renderer (`PluginManifestFile.dsp`): the allocator never sees that field,
 *  only the `ComponentManifest` passed to `adoptComponent`, so this cannot
 *  distinguish "brought DSP" from "brought none" (audio-probe qualifies with
 *  neither). Today EVERY plugin engine is routed through WorkletLaneEngine
 *  regardless of what it declares, so a plugin declaring `clipContent: 'audio'`
 *  with real per-sample DSP would still get the wrong backend — a gap slice 3
 *  closes when the backends stop being hard-coded in the allocator. */
export function isWorkletHosted(id: string): boolean {
  // A plugin is worklet-hosted by construction: bringing DSP through the ABI
  // means exactly this. An in-tree engine has to SAY so — which today only
  // LAYERS does, because it is in-tree solely to reach the worklet's registry
  // and build other engines out of it.
  return fromPlugin.has(id) || caps.get(id)?.workletHosted === true;
}

/** Every id `isWorkletHosted` answers true for. The host has no melodic engine
 *  of its own any more, so this IS the set of engines the worklet path routes —
 *  which is what a registry-driven test (audio-dsp/live-params.dsp.test.ts) has
 *  to walk. Read through `WORKLET_ENGINE_IDS` in the allocator, never here. */
export function workletHostedIds(): string[] {
  const own = [...caps.keys()].filter((id) => !fromPlugin.has(id) && caps.get(id)?.workletHosted);
  return [...fromPlugin, ...own];
}

/** What the host must multiply a PLUGIN engine's voices by: its declared
 *  balance times the category gain. This is the ONLY place that product is
 *  formed now — the host-side ENGINE_TRIM table it used to mirror went with the
 *  last built-in melodic engine. undefined when the id is not a plugin, so
 *  callers fall back to 1. */
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
