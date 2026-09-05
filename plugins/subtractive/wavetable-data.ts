// plugins/subtractive/wavetable-data.ts
// The eight single-cycle tables Osc3 morphs between. The SPECS are this
// engine's — a wave table is an identity, which is why they are written here
// and not imported from the Wavetable plugin, whose eight happen to start from
// the same series but carry a spectral warp this engine does not. The
// arithmetic that turns a spec into a table, and reads it, is the SDK's.
//
// Synthesised ONCE, at module evaluation — inside the worklet's addModule,
// before a single sample is rendered. A lazy build would land the first
// build's ~1M sines inside the render quantum of the first note that used
// Osc3, and that is a dropout with every light on screen still green.
//
// Order is the manifest's: osc3.waveA / osc3.waveB options index this array.
//   0 Sine · 1 Triangle · 2 Saw · 3 Square · 4 PWM 25% · 5 Organ · 6 Brass · 7 Vocal
import { synthWaveTable } from '@loom/plugin-sdk';

const HARMONICS = 64;

const spec = (fill: (imag: Float32Array) => void): Float32Array => {
  const imag = new Float32Array(HARMONICS);
  fill(imag);
  return imag;
};

const SPECS: Float32Array[] = [
  spec((im) => { im[1] = 1; }),
  spec((im) => { for (let k = 1; k < HARMONICS; k += 2) im[k] = (8 / (Math.PI * Math.PI * k * k)) * (((k - 1) / 2) % 2 === 0 ? 1 : -1); }),
  spec((im) => { for (let k = 1; k < HARMONICS; k++) im[k] = (2 / (Math.PI * k)) * (k % 2 === 0 ? 1 : -1); }),
  spec((im) => { for (let k = 1; k < HARMONICS; k += 2) im[k] = 4 / (Math.PI * k); }),
  spec((im) => { for (let k = 1; k < HARMONICS; k++) im[k] = (2 / (Math.PI * k)) * Math.sin(Math.PI * k * 0.25); }),
  spec((im) => { im[1] = 1; im[2] = 0.8; im[3] = 0.6; im[4] = 0.4; im[8] = 0.3; }),
  spec((im) => { for (let k = 1; k < 20; k++) im[k] = 1 / Math.pow(k, 0.7); }),
  spec((im) => { im[1] = 1; im[2] = 0.7; im[3] = 0.5; im[4] = 0.9; im[5] = 0.6; im[6] = 0.3; im[7] = 0.4; im[10] = 0.25; im[12] = 0.2; }),
];

export const WAVE_TABLES: readonly Float32Array[] = SPECS.map((imag) => synthWaveTable({ imag }));

/** The table at a wave index. A discrete param arrives as a number that may
 *  have been smoothed on its way here, so it is rounded and clamped. */
export function waveTableAt(idx: number): Float32Array {
  return WAVE_TABLES[Math.max(0, Math.min(WAVE_TABLES.length - 1, Math.round(idx)))];
}
