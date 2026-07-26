// src/engines/engine-randomize.ts
// The "🎲 Sound" dice, derived from what an engine DECLARES rather than from
// per-engine knowledge.
//
// It replaces randomizeBassParams (core/random.ts), which hand-picked musical
// sub-ranges for five TB-303 fields and only ever worked on the node-per-note
// TB303 class. When that class stopped being instantiated the button went dead
// in silence — it was reaching for a `getInstance()` no engine implements — and
// nothing else could use it because the ranges were hard-coded to one engine.
//
// Reading EngineParamSpec instead means every engine gets the dice for free,
// including engines that don't exist yet: the spec already carries the range,
// the kind and the default.
//
// The bias matters as much as the range. A flat roll over min..max mostly
// produces unusable sounds (attack slammed open, resonance screaming), which is
// why the old code hand-picked ranges. Generic code can't know those, so it
// biases toward the CURRENT default with a triangular distribution: most rolls
// land near a sound that already works, and the extremes are the tail rather
// than the norm.

import { isStripParamId } from '../core/channel-strip-params';
import type { EngineParamSpec } from './engine-params';

/** Params a sound dice must never touch, and why. */
function isExcluded(spec: EngineParamSpec): boolean {
  // The mixer channel is the DESK, not the instrument: rolling the fader or the
  // pan would move the lane in the mix, which is not what "randomize sound" means.
  if (isStripParamId(spec.id)) return true;
  // Polyphony/voice mode is a performance setting, not a timbre.
  if (spec.id.startsWith('poly.')) return true;
  // Detuning the lane against every other lane is never the intent — the dice
  // should change the character of the sound, not put it out of tune.
  if (spec.id === 'master.tune' || spec.id.endsWith('.master.tune')) return true;
  return false;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export interface RandomizeOptions {
  /** Injectable for tests and reproducible rolls. Defaults to Math.random. */
  rng?: () => number;
  /** Half-width of the triangular spread as a fraction of the full range
   *  (0 = no change, 1 = can reach either end from the centre). */
  amount?: number;
}

/**
 * Roll new values for every randomizable param the engine declares.
 *
 * Continuous params move around their default on a triangular distribution
 * (the sum of two uniforms), clamped to the declared range. Discrete params
 * pick a whole option index uniformly — a waveform or filter model has no
 * "near", so biasing it would be meaningless.
 */
export function randomizeEngineParams(
  engine: {
    params: readonly EngineParamSpec[];
    getBaseValue(id: string): number;
    setBaseValue(id: string, v: number): void;
  },
  opts: RandomizeOptions = {},
): void {
  const rng = opts.rng ?? Math.random;
  const amount = opts.amount ?? 0.5;

  for (const spec of engine.params) {
    if (isExcluded(spec)) continue;

    if (spec.kind === 'discrete') {
      const idx = Math.round(spec.min + rng() * (spec.max - spec.min));
      engine.setBaseValue(spec.id, clamp(idx, spec.min, spec.max));
      continue;
    }

    // Triangular around the default: (r1 + r2 - 1) is in [-1, 1], peaked at 0.
    const spread = (spec.max - spec.min) * amount;
    const delta = (rng() + rng() - 1) * spread;
    engine.setBaseValue(spec.id, clamp(spec.default + delta, spec.min, spec.max));
  }
}
