// src/notefx/random-processor.ts
// A musical note randomizer: per-parameter "chance" sliders decide whether a
// given note is transformed. When a parameter intervenes it applies a musically
// coherent random value. Different every time the transport starts, stable
// within one run because the RNG is seeded from NoteFxContext.seed.

import type { ScaleId } from '../core/musicality';
import { snapToScale } from '../core/musicality';
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';

export type RandomMode = 'random' | 'alt';
export type RandomSign = 'add' | 'sub' | 'bi';

export interface RandomProcessorParams {
  /** 0..1 chance that pitch is randomized. */
  chance: number;
  /** Number of possible pitches above/below the source (Ableton-style Choices). */
  choices: number;
  /** Semitone interval between choices (Ableton-style Interval). */
  interval: number;
  /** random = pure random; alt = round-robin through the choice pool. */
  mode: RandomMode;
  /** add = only up; sub = only down; bi = both directions. */
  sign: RandomSign;
  /** When true, generated pitches are snapped to the active scale. */
  scaleAware: boolean;
  /** Override key when scaleAware is true; -1 means "use context key". */
  key: number;
  /** Override scale when scaleAware is true; '' means "use context scale". */
  scale: ScaleId | '';

  /** 0..1 chance that velocity is randomized. */
  velChance: number;
  /** Velocity random range (0..1): at 1 a note can vary from ~silent to ~2x. */
  velRandom: number;

  /** 0..1 chance that gate duration is randomized. */
  durChance: number;
  /** Gate random range (0..1): at 1 a note can be 0.5x..2x its length. */
  durRandom: number;

  /** 0..1 chance that a note is dropped (silenced). */
  dropChance: number;
}

export const RANDOM_PROCESSOR_DEFAULTS: RandomProcessorParams = {
  chance: 0,
  choices: 6,
  interval: 1,
  mode: 'random',
  sign: 'bi',
  scaleAware: true,
  key: -1,
  scale: '',
  velChance: 0,
  velRandom: 0.3,
  durChance: 0,
  durRandom: 0.3,
  dropChance: 0,
};

// Tiny deterministic RNG (mulberry32). Seed is derived per note+parameter so
// every decision is independent and reproducible for the same run.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveSeed(base: number, note: NoteFxEvent, index: number, param: string): number {
  // Hash note time, pitch, index and param id into a stable integer seed.
  const timeBits = Math.floor(note.time * 100000) % 2147483647;
  let h = base ^ timeBits ^ (note.note * 374761393) ^ (index * 668265263);
  for (let i = 0; i < param.length; i++) {
    h = Math.imul(h ^ param.charCodeAt(i), 1664525);
  }
  return h >>> 0;
}

export class RandomProcessor implements NoteFxProcessor {
  private altIndex = 0;

  constructor(private params: RandomProcessorParams) {}

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    const p = this.params;
    const seed = ctx.seed ?? 0;
    const ctxKey = ctx.key ?? 9;
    const ctxScale = ctx.scale ?? 'minor';
    const out: NoteFxEvent[] = [];
    for (let i = 0; i < input.length; i++) {
      const e = input[i];

      // Drop: if the note is silenced, skip it entirely.
      if (p.dropChance > 0) {
        const dropRng = mulberry32(deriveSeed(seed, e, i, 'drop'));
        if (dropRng() < p.dropChance) continue;
      }

      let note = e.note;
      const time = e.time;
      let gate = e.gate;
      let accent = e.accent;
      let velocity = e.velocity;

      // Pitch randomization (Ableton Random-style).
      if (p.chance > 0) {
        const pitchRng = mulberry32(deriveSeed(seed, e, i, 'pitch'));
        if (pitchRng() < p.chance) {
          let delta = 0;
          if (p.mode === 'alt') {
            const steps = p.choices;
            delta = ((this.altIndex % steps) + 1) * p.interval;
            this.altIndex++;
          } else {
            const choice = Math.floor(pitchRng() * p.choices) + 1;
            delta = choice * p.interval;
          }
          if (p.sign === 'sub') delta = -delta;
          else if (p.sign === 'bi' && pitchRng() < 0.5) delta = -delta;
          note += delta;
          if (p.scaleAware) {
            const key = p.key >= 0 ? p.key : ctxKey;
            const scale = p.scale || ctxScale;
            note = snapToScale(note, key, scale);
          }
        }
      }

      // Velocity randomization (Ableton Velocity-style).
      if (p.velChance > 0 && p.velRandom > 0) {
        const velRng = mulberry32(deriveSeed(seed, e, i, 'velocity'));
        if (velRng() < p.velChance) {
          const hadVelocity = velocity !== undefined;
          const baseVel = velocity ?? (e.accent ? 127 : 100);
          const factor = 1 + (velRng() * 2 - 1) * p.velRandom;
          const next = Math.round(Math.max(1, Math.min(127, baseVel * factor)));
          if (hadVelocity || next !== baseVel) velocity = next;
          accent = next >= 100;
        }
      }

      // Duration / gate randomization (Ableton Note Length-style).
      if (p.durChance > 0 && p.durRandom > 0) {
        const durRng = mulberry32(deriveSeed(seed, e, i, 'duration'));
        if (durRng() < p.durChance) {
          const factor = 1 + (durRng() * 2 - 1) * p.durRandom;
          gate = Math.max(0.01, gate * factor);
        }
      }

      out.push({ note, time, gate, accent, velocity });
    }
    return out;
  }
}
