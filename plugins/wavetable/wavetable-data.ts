// plugins/wavetable/wavetable-data.ts
// These tables ARE this engine's sound, so they live inside the plugin rather
// than in the SDK: what earns a place in @loom/plugin-sdk is a primitive that
// fits ANY engine, and a wave table is an identity, not a primitive.
//
// Single source of truth for the wavetable harmonic specs AND their synthesised
// single-cycle (2048-sample) Float32Arrays. Pure — no Web Audio dependency.
//   - WAVETABLES: the {name, real, imag} Fourier specs (used for UI labels and
//     as the canonical wave ORDER: 0=Sine 1=Triangle 2=Sawtooth 3=Square
//     4=PWM25% 5=Organ 6=Brass 7=Vocal — osc.waveA / osc.waveB indices).
//   - getWaveTables(): the additively-synthesised single-cycle tables, lazily
//     computed and cached. Used by WavetableRenderer.
// (Previously this duplicated the generators in src/engines/wavetable-tables.ts;
//  that file was merged here so the spec lives in one place.)

const N = 2048;
const HARMONICS = 64;

export interface WaveTableDef {
  name: string;
  real: Float32Array;
  imag: Float32Array;
}

function makeSine(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1;
  return { name: 'Sine', real, imag };
}

function makeTriangle(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 2) {
    imag[k] = (8 / (Math.PI * Math.PI * k * k)) * (((k - 1) / 2) % 2 === 0 ? 1 : -1);
  }
  return { name: 'Triangle', real, imag };
}

function makeSawtooth(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    imag[k] = (2 / (Math.PI * k)) * (k % 2 === 0 ? 1 : -1);
  }
  return { name: 'Sawtooth', real, imag };
}

function makeSquare(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 2) {
    imag[k] = 4 / (Math.PI * k);
  }
  return { name: 'Square', real, imag };
}

function makePWM(duty: number): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    imag[k] = (2 / (Math.PI * k)) * Math.sin(Math.PI * k * duty);
  }
  return { name: `PWM ${Math.round(duty * 100)}%`, real, imag };
}

function makeOrgan(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1.0;
  imag[2] = 0.8;
  imag[3] = 0.6;
  imag[4] = 0.4;
  imag[8] = 0.3;
  return { name: 'Organ', real, imag };
}

function makeBrass(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < Math.min(HARMONICS, 20); k++) {
    imag[k] = 1 / Math.pow(k, 0.7);
  }
  return { name: 'Brass', real, imag };
}

function makeVocal(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1.0;
  imag[2] = 0.7;
  imag[3] = 0.5;
  imag[4] = 0.9;
  imag[5] = 0.6;
  imag[6] = 0.3;
  imag[7] = 0.4;
  imag[10] = 0.25;
  imag[12] = 0.2;
  return { name: 'Vocal', real, imag };
}

/** Canonical wave specs and ORDER. Indices: 0=Sine 1=Triangle 2=Sawtooth
 *  3=Square 4=PWM25% 5=Organ 6=Brass 7=Vocal. */
export const WAVETABLES: WaveTableDef[] = [
  makeSine(),
  makeTriangle(),
  makeSawtooth(),
  makeSquare(),
  makePWM(0.25),
  makeOrgan(),
  makeBrass(),
  makeVocal(),
];

/**
 * Synthesise one single-cycle Float32Array from the Fourier imag/real coefficients.
 * sum_k imag[k]*sin(2π k n/N) + real[k]*cos(2π k n/N), peak-normalised to ±1.
 */
function synth(spec: WaveTableDef): Float32Array {
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const ph = (n / N) * 2 * Math.PI;
    let s = 0;
    for (let k = 1; k < spec.imag.length; k++) {
      s += (spec.imag[k] ?? 0) * Math.sin(k * ph);
      if (spec.real[k]) s += spec.real[k] * Math.cos(k * ph);
    }
    out[n] = s;
  }
  // Peak-normalise so ±1 output is consistent across all tables.
  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  if (pk > 1e-9) for (let n = 0; n < N; n++) out[n] /= pk;
  return out;
}

let cache: Float32Array[] | null = null;

/**
 * Returns the array of single-cycle wavetables. Lazily computed once and cached.
 * Index matches WAVETABLES order above.
 */
export function getWaveTables(): Float32Array[] {
  if (!cache) cache = WAVETABLES.map(synth);
  return cache;
}

// ── Spectral warp ────────────────────────────────────────────────────────────
// The tables are BORN as Fourier specs, so the warp is native: transform the
// harmonics, resynthesise, cache. The AMOUNT is quantised to SPECTRAL_STEPS so
// a live sweep swaps between a bounded set of precomputed tables instead of
// resynthesising per sample — each (wave, mode, step) is paid for once, ever.
// Order pinned by the manifest options: 0=Stretch 1=Smear 2=Low-pass 3=Random.

export const SPECTRAL_MODES = ['Stretch', 'Smear', 'Low-pass', 'Random'] as const;
export const SPECTRAL_STEPS = 32;

/** Deterministic 0..1 per (harmonic, wave) — the offline export renders in a
 *  different order from the live path, so Math.random here would make an
 *  export sound different from what was heard. */
function hash01(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function warpSpec(src: WaveTableDef, mode: number, amt: number, waveIdx: number): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  if (mode === 0) {
    // Stretch: harmonic k lands at round(k·(1+amt)). Collisions add, the top
    // falls off the table, and the gaps the stretched grid skips are the
    // sound of it.
    const f = 1 + amt;
    for (let k = 1; k < HARMONICS; k++) {
      const kk = Math.round(k * f);
      if (kk < HARMONICS) {
        real[kk] += src.real[k];
        imag[kk] += src.imag[k];
      }
    }
  } else if (mode === 1) {
    // Smear: box-blur the spec across neighbours. Blurring real/imag rather
    // than magnitude also blurs phase — cheaper, and the wash is the point.
    const w = Math.max(1, Math.round(amt * 6));
    for (let k = 1; k < HARMONICS; k++) {
      let r = 0;
      let i2 = 0;
      let cnt = 0;
      for (let j = Math.max(1, k - w); j <= Math.min(HARMONICS - 1, k + w); j++) {
        r += src.real[j];
        i2 += src.imag[j];
        cnt++;
      }
      real[k] = r / cnt;
      imag[k] = i2 / cnt;
    }
  } else if (mode === 2) {
    // Spectral low-pass: everything above the cutoff harmonic rolls off
    // exponentially. Squared curve so the knob's first half is gentle.
    const kc = 1 + (HARMONICS - 1) * Math.pow(1 - amt, 2);
    for (let k = 1; k < HARMONICS; k++) {
      const g = k <= kc ? 1 : Math.exp(-(k - kc) / 2);
      real[k] = src.real[k] * g;
      imag[k] = src.imag[k] * g;
    }
  } else {
    // Random amplitudes: each harmonic keeps or loses level by its own
    // seeded coin. 1.5 ceiling so the expected energy stays near unity.
    for (let k = 1; k < HARMONICS; k++) {
      const g = 1 - amt + amt * 1.5 * hash01(k * 31 + waveIdx * 977);
      real[k] = src.real[k] * g;
      imag[k] = src.imag[k] * g;
    }
  }
  return { name: src.name, real, imag };
}

const warped = new Map<number, Float32Array>();

/** The single-cycle table for wave `waveIdx` warped by `mode` at quantised
 *  `step` (0..SPECTRAL_STEPS; 0 = the untouched original, same reference the
 *  parity render pins). Cached per (wave, mode, step); the ceiling covers a
 *  hand sweeping everything and then starts over rather than growing. */
export function getWarpedTable(waveIdx: number, mode: number, step: number): Float32Array {
  const tables = getWaveTables();
  const wi = Math.max(0, Math.min(tables.length - 1, Math.round(waveIdx)));
  const s = Math.max(0, Math.min(SPECTRAL_STEPS, Math.round(step)));
  if (s === 0) return tables[wi];
  const m = Math.max(0, Math.min(SPECTRAL_MODES.length - 1, Math.round(mode)));
  const key = (wi << 16) | (m << 8) | s;
  const hit = warped.get(key);
  if (hit) return hit;
  if (warped.size > 96) warped.clear();   // ~0.8 MB ceiling
  const t = synth(warpSpec(WAVETABLES[wi], m, s / SPECTRAL_STEPS, wi));
  warped.set(key, t);
  return t;
}
