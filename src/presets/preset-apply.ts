// Single entry point for applying a named, prefix-tagged preset to a
// session lane's engine instance.
//
// Preset names in session state and the dropdown UI carry a prefix from the
// unified preset vocabulary:
//
//   engine:<NAME>   — a built-in / JSON preset (a SynthEngine.presets entry).
//                     THE canonical form for every engine's factory presets —
//                     subtractive, tb303, fm, wavetable, karplus, drums-machine.
//                     Applied via engine.applyPreset(NAME) (writes each param
//                     through setBaseValue).
//   user:<NAME>     — a subtractive user-saved preset (localStorage, stored as
//                     PolySynthParams). Genuinely different storage.
//   sampler:<KIND>:<ID> — a sampler instrument / drumkit / loop ref (async load).
//
// The helper is pure WRT the UI: it does NOT refresh the preset dropdown or
// knob handles. Call sites that need UI sync (the session-host's
// applyPresetForLane wiring) handle that themselves after calling this.

import type { SynthEngine } from '../engines/engine-types';
import type { PolySynth } from '../polysynth/polysynth';
import { applyPresetByName } from '../polysynth/polysynth-presets';

/** Apply a prefix-tagged preset name to an engine instance. Unknown preset
 *  NAMES silently no-op inside the engine. */
export function applyPresetToEngine(engine: SynthEngine, presetName: string): void {
  if (presetName.startsWith('user:')) {
    const bare = presetName.slice('user:'.length);
    const ps = (engine as { getPolySynth?(): PolySynth | null }).getPolySynth?.();
    if (ps) { applyPresetByName(ps, bare); return; }
    // Non-PolySynth engine (tb303 / karplus / fm / wavetable / drums): its
    // "factory" presets ARE the engine's own JSON preset list. Without this
    // fallback, every non-Subtractive demo lane loaded as "(custom — no
    // preset)" because user: silently no-op'd here.
    engine.applyPreset(bare);
    return;
  }
  if (presetName.startsWith('engine:')) {
    const bare = presetName.slice('engine:'.length);
    engine.applyPreset(bare);
    return;
  }
  // Unprefixed names: assume they target the engine's flat preset list
  // (defensive — current callers always supply a prefix).
  engine.applyPreset(presetName);
}

/** Convenience: look up the lane's engine via the provided lookup, then
 *  apply. Returns false if the lane has no live engine (lane was deleted
 *  or resources weren't allocated). */
export function applyPresetToLane(
  laneId: string,
  presetName: string,
  getLaneEngineInstance: (laneId: string) => SynthEngine | null,
): boolean {
  const engine = getLaneEngineInstance(laneId);
  if (!engine) return false;
  applyPresetToEngine(engine, presetName);
  return true;
}
