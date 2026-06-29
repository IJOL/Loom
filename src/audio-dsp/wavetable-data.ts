// src/audio-dsp/wavetable-data.ts
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
