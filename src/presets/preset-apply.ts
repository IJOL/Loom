// Single entry point for applying a named, prefix-tagged preset to a
// session lane's engine instance.
//
// Preset names in session state and the dropdown UI carry a prefix from the
// unified preset vocabulary:
//
//   engine:<NAME>   — a built-in / JSON preset (a SynthEngine.presets entry).
//                     THE canonical form for every engine's factory presets —
//                     subtractive, tb303, fm, wavetable, drums-machine.
//                     Applied via engine.applyPreset(NAME) (writes each param
//                     through setBaseValue).
//   user:<NAME>     — a subtractive user-saved preset (localStorage, stored as
//                     PolySynthParams). Genuinely different storage.
//
// `sampler:<KIND>:<ID>` — a drumkit / melodic instrument / loop ref — is part of
// the dropdown's vocabulary but NOT of this function's: loading one is an async
// fetch + decode, so it goes through `SamplerWorkletEngine.loadFamilyRef`, and a
// sampler lane records what it plays in `engineState.sampler` rather than in
// `enginePresetName`. This listed it as if it were handled here, which it never
// was — the call would have fallen through to `engine.applyPreset('sampler:…')`
// and silently no-opped.
//
// The helper is pure WRT the UI: it does NOT refresh the preset dropdown or
// knob handles. Call sites that need UI sync (the session-host's
// applyPresetForLane wiring) handle that themselves after calling this.

import type { SynthEngine } from '../engines/engine-types';

/** Apply a prefix-tagged preset name to an engine instance. Unknown preset
 *  NAMES silently no-op inside the engine. */
export function applyPresetToEngine(engine: SynthEngine, presetName: string): void {
  if (presetName.startsWith('user:')) {
    // `user:` and `engine:` land in the same place. There used to be a branch
    // ahead of this one asking the engine for a PolySynth instance — no engine
    // implements getPolySynth(), so it always fell through to exactly this call.
    const bare = presetName.slice('user:'.length);
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
