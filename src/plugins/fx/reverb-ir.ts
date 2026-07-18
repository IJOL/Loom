// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from mpump's drumSynth.ts (generateImpulseResponse + REVERB_PRESETS)
// — https://github.com/gdamdam/mpump
// Copyright (C) 2024-2026 gdamdam, licensed AGPL-3.0-or-later. Loom inherits
// that licence here; see LICENSE.
//
// Synthetic impulse responses for the reverb insert.
//
// The previous IR was one line — white noise under a power curve. That is a
// noise burst, not a room: it has no early reflections, no diffusion, and no
// character to distinguish a plate from a hall. This builds a real one, in five
// passes, and the passes are what the type names actually mean:
//
//   1. Early reflections — discrete taps whose TIMES are the room's geometry.
//   2. Diffuse tail      — noise under an exponential decay, after a predelay.
//   3. Brightness        — a one-pole LP on the tail (hall dark, plate bright).
//   4. Allpass diffusion — a Schroeder cascade; smears the noise into a wash.
//   5. DC blocking       — without it a convolver pumps the whole mix.
//
// Pure maths over Float32Arrays: no AudioContext, so it unit-tests directly.

export type ReverbType = 'room' | 'hall' | 'plate' | 'spring';

export const REVERB_TYPES: readonly ReverbType[] = ['room', 'hall', 'plate', 'spring'];

/** Deterministic PRNG (mulberry32). A seeded tail means the same scene renders
 *  the same IR every time — offline exports match what you heard. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ReverbProfile {
  /** Early-reflection arrival times (seconds) — the room's geometry. */
  erTimes: number[];
  /** Gain of each reflection; monotonically falling. */
  erGains: number[];
  /** Left/right arrival skew (seconds) that decorrelates the channels. */
  erStereo: number;
  /** Gap before the diffuse tail starts. Bigger space → longer. */
  predelay: number;
  /** One-pole LP coefficient on the tail. 0 = dark, 1 = bright. */
  tailBright: number;
  /** Allpass delay lengths (seconds); one per diffusion stage. */
  apDelays: number[];
  /** Allpass feedback gain. */
  apGain: number;
  /** Noise level in the diffuse tail. */
  density: number;
}

const PROFILES: Record<ReverbType, ReverbProfile> = {
  // Small, bright, tight cluster of reflections.
  room: {
    erTimes:  [0.007, 0.013, 0.019, 0.027, 0.037, 0.048, 0.061, 0.079],
    erGains:  [0.85, 0.72, 0.60, 0.50, 0.40, 0.32, 0.25, 0.18],
    erStereo: 0.002, predelay: 0.06, tailBright: 0.6,
    apDelays: [0.0037, 0.0113], apGain: 0.6, density: 2.0,
  },
  // Large and DARK — reflections spread far out, highs roll away.
  hall: {
    erTimes:  [0.012, 0.024, 0.038, 0.055, 0.074, 0.096, 0.121, 0.150, 0.183, 0.220],
    erGains:  [0.90, 0.78, 0.67, 0.57, 0.48, 0.40, 0.33, 0.27, 0.22, 0.17],
    erStereo: 0.004, predelay: 0.10, tailBright: 0.4,
    apDelays: [0.0047, 0.0137, 0.0211], apGain: 0.65, density: 2.5,
  },
  // No room at all: a steel sheet. Near-instant, very bright, very dense.
  plate: {
    erTimes:  [0.002, 0.005, 0.008, 0.012, 0.017, 0.023],
    erGains:  [0.95, 0.85, 0.75, 0.65, 0.55, 0.45],
    erStereo: 0.001, predelay: 0.01, tailBright: 0.85,
    apDelays: [0.0013, 0.0037, 0.0067, 0.0097], apGain: 0.7, density: 3.0,
  },
  // A spring's boing: reflections arrive in PAIRS (the wave reflecting off both
  // ends), which is what makes it sound like a guitar amp and not a room.
  spring: {
    erTimes:  [0.003, 0.030, 0.033, 0.060, 0.063, 0.090],
    erGains:  [0.90, 0.70, 0.65, 0.50, 0.45, 0.35],
    erStereo: 0.0005, predelay: 0.03, tailBright: 0.5,
    apDelays: [0.0029, 0.0089], apGain: 0.55, density: 1.8,
  },
};

export interface ReverbIROptions {
  sampleRate: number;
  /** IR length in seconds (the "size" knob). */
  seconds: number;
  /** How fast the tail dies WITHIN that length. Higher = shorter tail. */
  decay: number;
  type: ReverbType;
}

/** Build one channel of the IR in place. */
function renderChannel(data: Float32Array, ch: number, opts: ReverbIROptions, p: ReverbProfile): void {
  const { sampleRate: rate, seconds, decay } = opts;
  const len = data.length;
  // Seed per channel so L and R are decorrelated — a shared seed would collapse
  // the reverb to mono the moment the tail dominates.
  const rand = seededRandom(ch === 0 ? 7919 : 104729);

  // ── 1. Early reflections ──────────────────────────────────────────────────
  for (let r = 0; r < p.erTimes.length; r++) {
    const skew = ch === 0 ? 0 : p.erStereo * (r % 3 === 0 ? 1 : -1);
    const idx = Math.round((p.erTimes[r] + skew) * rate);
    if (idx >= 0 && idx < len) {
      // Alternating polarity on the right channel widens the image.
      data[idx] += p.erGains[r] * (ch === 0 ? 1 : -1 + 2 * (r % 2));
    }
  }

  // ── 2. Diffuse tail ───────────────────────────────────────────────────────
  const predelay = Math.min(len, Math.round(p.predelay * rate));
  // decay=3 (the default) reproduces the reference curve 1/(rate·len·0.45).
  const decayRate = decay / (rate * Math.max(0.05, seconds) * 1.35);
  for (let i = predelay; i < len; i++) {
    data[i] += (rand() * 2 - 1) * p.density * Math.exp(-(i - predelay) * decayRate);
  }

  // ── 3. Brightness (one-pole LP over the tail) ─────────────────────────────
  if (p.tailBright < 1) {
    let lp = 0;
    for (let i = predelay; i < len; i++) {
      lp += p.tailBright * (data[i] - lp);
      data[i] = lp;
    }
  }

  // ── 4. Schroeder allpass diffusion ────────────────────────────────────────
  for (const apSec of p.apDelays) {
    const apLen = Math.max(1, Math.round(apSec * rate));
    const apBuf = new Float32Array(apLen);
    let apIdx = 0;
    for (let i = 0; i < len; i++) {
      const delayed = apBuf[apIdx];
      const input = data[i];
      data[i] = -input * p.apGain + delayed;
      apBuf[apIdx] = input + delayed * p.apGain;
      apIdx = apIdx + 1 === apLen ? 0 : apIdx + 1;
    }
  }

  // ── 5. DC blocking ────────────────────────────────────────────────────────
  let x1 = 0, y1 = 0;
  for (let i = 0; i < len; i++) {
    const x = data[i];
    y1 = x - x1 + 0.995 * y1;
    x1 = x;
    data[i] = y1;
  }
}

/** Generate a stereo impulse response. Deterministic for a given request. */
export function generateReverbIR(opts: ReverbIROptions): { left: Float32Array; right: Float32Array } {
  const len = Math.max(1, Math.ceil(opts.sampleRate * Math.max(0.05, opts.seconds)));
  const p = PROFILES[opts.type] ?? PROFILES.room;
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  renderChannel(left, 0, opts, p);
  renderChannel(right, 1, opts, p);
  return { left, right };
}
