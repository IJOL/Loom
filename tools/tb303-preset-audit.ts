// tools/tb303-preset-audit.ts
// Renders every TB-303 preset through the REAL renderer and reports what the
// knob values actually become in DSP: ladder resonance, base/peak cutoff, filter
// decay vs. the step length, plus measured low-band vs high-band energy.
//
// Run: npx vite-node tools/tb303-preset-audit.ts
import { readFileSync } from 'node:fs';
import { TB303Renderer } from '../src/audio-dsp/tb303-renderer';
import { PRESET_KEY_TO_SPEC } from '../src/engines/tb303';

const SR = 44100;
const BPM = 130;
const STEP = 60 / BPM / 4;          // 16th note = 0.1154 s
const TAIL = 0.35;
const MIDI = 33;                     // A1, 55 Hz — bass register

interface Preset { name: string; params: Record<string, number> }
const bank = JSON.parse(readFileSync('public/presets/tb303.json', 'utf8')) as { presets: Preset[] };

function toBag(p: Preset): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.params)) bag[PRESET_KEY_TO_SPEC[k] ?? k] = v;
  return bag;
}

function render(bag: Record<string, number>, accent: boolean): Float32Array {
  const n = Math.round((STEP + TAIL) * SR);
  const out = new Float32Array(n);
  const r = new TB303Renderer(
    { midi: MIDI, beginSec: 0, durationSec: STEP, velocity: 0.8, accent, slide: false },
    bag, SR,
  );
  for (let i = 0; i < n; i++) out[i] = r.renderSample(i / SR);
  return out;
}

// --- naive DFT over a few bands (cheap, no FFT dependency) -------------------
function bandEnergy(buf: Float32Array, lo: number, hi: number): number {
  // Goertzel-ish: sum |X(f)|^2 over 1/3-octave centres inside [lo, hi]
  let total = 0;
  for (let f = lo; f < hi; f *= 2 ** (1 / 3)) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < buf.length; i++) { re += buf[i] * Math.cos(w * i); im += buf[i] * Math.sin(w * i); }
    total += (re * re + im * im) / (buf.length * buf.length);
  }
  return total;
}

function rms(buf: Float32Array): number {
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

const Q_MIN = 1, Q_MAX = 31;
const qToLadderRes = (q: number) => Math.min(1, ((Math.max(Q_MIN, q) - Q_MIN) / (Q_MAX - Q_MIN)) ** 0.7);

const rows: string[] = [];
rows.push(
  ['preset', 'res', 'ladder', 'accLad', 'baseHz', 'peakHz', 'decay', 'dec/step', 'low', 'high', 'hi/low', 'rms']
    .map((h) => h.padEnd(h === 'preset' ? 20 : 8)).join(''),
);

for (const p of bank.presets) {
  const bag = toBag(p);
  const res = bag['filter.resonance'];
  const cutoff = bag['filter.cutoff'];
  const envMod = bag['env.amount'];
  const decay = bag['env.decay'];
  const accentAmt = bag['env.accent'];

  const baseHz = 80 * 100 ** cutoff;
  const peakHz = Math.min(baseHz + envMod * 6000, 18000);
  const decaySec = 0.05 + decay * 1.2;
  const ladder = qToLadderRes(1 + res * 25);
  const accLad = qToLadderRes(1 + res * 25 + accentAmt * 6);

  const buf = render(bag, false);
  const low = bandEnergy(buf, 40, 200);
  const high = bandEnergy(buf, 800, 8000);

  const f = (x: number, d = 2) => x.toFixed(d).padEnd(8);
  rows.push(
    p.name.padEnd(20) + f(res) + f(ladder) + f(accLad) +
    Math.round(baseHz).toString().padEnd(8) + Math.round(peakHz).toString().padEnd(8) +
    f(decaySec) + f(decaySec / STEP, 1) +
    low.toExponential(1).padEnd(8) + high.toExponential(1).padEnd(8) +
    f(high / Math.max(low, 1e-12), 1) + f(rms(buf), 3),
  );
}

console.log(rows.join('\n'));
