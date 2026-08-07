// src/audio-dsp/renderer-registry.ts
// Maps engineId → a per-note VoiceRenderer constructor. Each engine's renderer
// file self-registers here (side-effect on import); the worklet's VoiceManager
// builds voices through createRenderer(). Pure — no Web Audio / worklet globals.
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';

type Ctor = (note: NoteSpec, params: ParamBag, sampleRate: number, structural?: unknown) => VoiceRenderer;

const REGISTRY = new Map<string, Ctor>();

export function registerRenderer(engineId: string, ctor: Ctor): void {
  REGISTRY.set(engineId, ctor);
}

/** `structural` is per-lane state that is NOT a number — the only kind a param
 *  cannot carry. Optional and last, so every renderer written before it existed
 *  simply ignores an extra argument; `unknown` because the host genuinely does
 *  not know what an engine's structural state looks like, and a union of the
 *  ones we happen to ship would have to grow for every future plugin. */
export function createRenderer(
  engineId: string, note: NoteSpec, params: ParamBag, sr: number, structural?: unknown,
): VoiceRenderer {
  const c = REGISTRY.get(engineId);
  if (!c) throw new Error(`no renderer registered for engine '${engineId}'`);
  return c(note, params, sr, structural);
}

/** Test/introspection helper. */
export function hasRenderer(engineId: string): boolean { return REGISTRY.has(engineId); }
