// src/audio-dsp/drums/types.ts
// Shared types for the per-sample worklet drum machine (Phase 2b). Pure — no
// Web Audio / worklet globals.
import type { ParamBag } from '../types';

export type DrumVoiceId =
  | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'clap' | 'cowbell' | 'tom' | 'ride';

/** Canonical drum-voice order. Single source of truth for the worklet's
 *  output↔voice mapping (manager render index, node connectVoice, strip wiring).
 *  Matches DRUM_LANES in src/core/drums.ts. */
export const DRUM_VOICE_IDS: DrumVoiceId[] = [
  'kick', 'snare', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride',
];

/** One drum hit. `velocity` already folds accent in (the engine resolves it). */
export interface DrumHit { voice: DrumVoiceId; beginSec: number; velocity: number; }

/** A one-shot drum voice renderer (pure). Drum voices have a fixed decay
 *  envelope — no gate sustain — so there is no noteOff; `done` flips true once
 *  the decay (or a choke fade) has fully elapsed. */
export interface DrumRenderer {
  /** Render one mono sample at absolute time t (seconds). */
  renderSample(t: number): number;
  /** True once the decay (or choke fade) has fully decayed at the last t. */
  readonly done: boolean;
  /** Value the amp envelope has reached at time t (for choke fade-from). */
  ampAt(t: number): number;
  /** Start a fast fade-to-zero at time t (choke). */
  choke(t: number): void;
}

export type DrumRendererCtor = (hit: DrumHit, params: ParamBag, sampleRate: number) => DrumRenderer;
