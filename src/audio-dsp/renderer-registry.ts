// src/audio-dsp/renderer-registry.ts
// Maps engineId → a per-note VoiceRenderer constructor. Each engine's renderer
// file self-registers here (side-effect on import); the worklet's VoiceManager
// builds voices through createRenderer(). Pure — no Web Audio / worklet globals.
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';

type Ctor = (note: NoteSpec, params: ParamBag, sampleRate: number) => VoiceRenderer;

const REGISTRY = new Map<string, Ctor>();

export function registerRenderer(engineId: string, ctor: Ctor): void {
  REGISTRY.set(engineId, ctor);
}

export function createRenderer(engineId: string, note: NoteSpec, params: ParamBag, sr: number): VoiceRenderer {
  const c = REGISTRY.get(engineId);
  if (!c) throw new Error(`no renderer registered for engine '${engineId}'`);
  return c(note, params, sr);
}

/** Test/introspection helper. */
export function hasRenderer(engineId: string): boolean { return REGISTRY.has(engineId); }
