// src/audio-dsp/param-index.ts
// Numbers an engine's declared params ONCE, so the audio loop can address them
// by slot instead of by name.
//
// Why this exists: Subtractive used to read a typed struct while every other
// engine read a bag keyed by dot-id, an optimisation types.ts described as one
// "no plugin should depend on". A plugin cannot have a typed struct — the host
// does not know its fields — so the choice was to take the optimisation away
// from Subtractive or to give it to everyone. This is giving it to everyone:
// every engine declares its params, so every engine can be numbered, plugins
// included.
//
// Names do not disappear. They stay in the manifest, the presets, the session
// state and the messages to the worklet. Only the hot loop is numeric.

/** Modulation destinations that are not declared params: the per-voice
 *  amplitude envelope, a multiplicative output gain (tremolo), and the filter
 *  envelope. They are appended AFTER the declared ids so that adding one can
 *  never renumber a declared param — renderers resolve their slots once and
 *  hold them for the life of the voice. */
export const SYNTHETIC_TARGETS = ['amp', 'ampGain', 'filterEnv'] as const;

export interface ParamIndex {
  /** id → slot. An id with no entry is NOT addressable, and that is the point:
   *  a typo in a plugin manifest used to create a key nobody ever read. */
  readonly slot: Readonly<Record<string, number>>;
  /** How many slots a value array needs to cover this engine. */
  readonly length: number;
}

/** Build the index for one engine from its declared param ids, in declaration
 *  order. Repeats keep their first slot; an id that is both a declared param and
 *  a synthetic target gets one slot, not two. */
export function buildParamIndex(ids: readonly string[]): ParamIndex {
  const slot: Record<string, number> = {};
  let n = 0;
  for (const id of ids) if (!(id in slot)) slot[id] = n++;
  for (const t of SYNTHETIC_TARGETS) if (!(t in slot)) slot[t] = n++;
  return { slot, length: n };
}
