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

export function createPeriodicWaves(ctx: AudioContext): PeriodicWave[] {
  return WAVETABLES.map((t) => ctx.createPeriodicWave(t.real, t.imag));
}
