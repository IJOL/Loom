// src/audio-dsp/karplus-renderer.ts
// Pure per-sample Karplus-Strong renderer for the AudioWorklet engine.
// The heavy lifting is done by renderKarplusString (lifted verbatim from the
// legacy src/engines/karplus.ts). The renderer pre-renders the full string
// buffer at construction time, then plays it back sample-by-sample with an
// optional amp envelope.
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';

// ── Karplus-Strong string renderer (offline, per note) ────────────────────
// Verbatim copy of the pure-JS implementation from src/engines/karplus.ts.
// src/engines/karplus.ts imports this function from here so there is only one
// copy (DRY); the legacy engine and the worklet renderer both use this path.
export function renderKarplusString(opts: {
  sampleRate: number; freq: number; damping: number; brightness: number;
  exciteDur: number; noiseTone: number; seconds: number;
}): Float32Array {
  const { sampleRate: fs, freq, damping, brightness, exciteDur, noiseTone } = opts;
  const N = Math.max(1, Math.round(opts.seconds * fs));
  const out = new Float32Array(N);

  // Loop low-pass coefficient from brightness (one-pole y += a·(x−y)):
  // 0.15 ≈ 1 kHz cutoff (dark) … 0.95 ≈ 20 kHz (open/metallic).
  const a = 0.15 + brightness * 0.80;
  // Loop gain → decay time. A FIXED loop gain makes the 60 dB decay time
  // T60 ∝ 1/freq (amp(t) = g^(freq·t)), so high notes die far too fast — C6
  // collapses in ~0.1 s, which is both unmusical and left the top of the
  // register near-silent. Instead choose g PER NOTE so T60 is set by `damping`
  // and is ~constant across the register: solve g^(freq·T60) = 1e-3 for g.
  //   damping 0 → T60 ≈ 4.0 s (long sustain)   damping 1 → T60 ≈ 0.12 s (muted)
  // Clamped just below 1 for safety (the loop only runs offline, so there is no
  // live feedback path to destabilize regardless).
  const t60 = 4.0 * Math.pow(0.03, damping);
  const g = Math.min(0.9995, Math.exp(Math.log(1e-3) / (Math.max(20, freq) * t60)));

  // Delay length = period minus the one-pole's low-frequency group delay
  // ((1−a)/a samples), so the filtered loop resonates at the true pitch.
  const period = fs / Math.max(20, freq);
  const Ldelay = Math.max(1, period - (1 - a) / a);
  const Li = Math.floor(Ldelay);
  const frac = Ldelay - Li;
  const dlSize = Li + 2;
  const dl = new Float32Array(dlSize);
  let widx = 0;
  let lp = 0;

  // Excitation: a band-limited white-noise burst whose colour is set by
  // noiseTone (200 Hz dark … 12 kHz bright), with a short raised-cosine
  // fade-out so the burst's end doesn't click.
  const exciteLen = Math.min(N, Math.max(4, Math.round(exciteDur * fs)));
  const noiseHz = Math.min(fs * 0.45, 200 * Math.pow(60, noiseTone));
  const na = 1 - Math.exp(-2 * Math.PI * noiseHz / fs);
  let nlp = 0;
  const FADE = 32;

  for (let n = 0; n < N; n++) {
    let exc = 0;
    if (n < exciteLen) {
      const w = Math.random() * 2 - 1;
      nlp += na * (w - nlp);
      exc = nlp;
      if (n > exciteLen - FADE) {
        exc *= 0.5 - 0.5 * Math.cos(Math.PI * (exciteLen - n) / FADE);
      }
    }
    const i0 = (widx - Li + dlSize) % dlSize;
    const i1 = (i0 - 1 + dlSize) % dlSize;
    const read = dl[i0] * (1 - frac) + dl[i1] * frac;
    lp += a * (read - lp);
    const s = exc + g * lp;
    out[n] = s;
    dl[widx] = s;
    widx = widx + 1 === dlSize ? 0 : widx + 1;
  }

  // DC blocker (one-pole high-pass, R≈0.997) so the random burst leaves no
  // subsonic offset to thump the amp.
  let xPrev = 0, yPrev = 0;
  const R = 0.997;
  for (let n = 0; n < N; n++) {
    const x = out[n];
    const y = x - xPrev + R * yPrev;
    xPrev = x; yPrev = y; out[n] = y;
  }

  // Peak-normalize to fixed headroom: the output GainNode becomes the sole
  // level control and a single note can never clip regardless of resonance.
  let pk = 0;
  for (let n = 0; n < N; n++) { const v = Math.abs(out[n]); if (v > pk) pk = v; }
  if (pk > 1e-9) { const k = 1.0 / pk; for (let n = 0; n < N; n++) out[n] *= k; }
  return out;
}

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class KarplusRenderer implements VoiceRenderer {
  private buf: Float32Array;
  private sr: number;
  private begin: number;
  private holdEnd: number;
  private atk: number;
  private rel: number;
  private level: number;
  private ampEnvOn: boolean;
  private vel: number;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, sampleRate: number) {
    this.sr = sampleRate;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.atk = Math.max(0.001, param(p, 'amp.attack', 0.005));
    this.rel = Math.max(0.05, param(p, 'amp.release', 0.5));
    this.level = param(p, 'amp.level', 0.8);
    this.ampEnvOn = param(p, 'amp.builtinEnv', 1) >= 0.5;
    this.vel = note.velocity * (note.accent ? 1.3 : 1);
    const seconds = Math.min(8, Math.max(0.4, note.durationSec + this.rel + 0.3));
    this.buf = renderKarplusString({
      sampleRate,
      freq: midiToFreq(note.midi),
      damping: param(p, 'string.damping', 0.5),
      brightness: param(p, 'string.brightness', 0.65),
      exciteDur: Math.max(0.001, param(p, 'excite.time', 0.01)),
      noiseTone: param(p, 'excite.tone', 0.5),
      seconds,
    });
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const idx = Math.floor((t - this.begin) * this.sr);
    if (idx >= this.buf.length) { this.done = true; return 0; }
    let env = 1;
    if (this.ampEnvOn) {
      const dt = t - this.begin;
      const relStart = this.holdEnd - this.begin;
      if (dt < this.atk) {
        env = dt / this.atk;
      } else if (dt < relStart) {
        env = 1;
      } else {
        env = Math.exp(-(dt - relStart) / this.rel);
        if (t > this.holdEnd && env < 0.001) this.done = true;
      }
    }
    return this.buf[idx] * env * this.level * this.vel * synthTrim('karplus');
  }
}

registerRenderer('karplus', (n, p, sr) => new KarplusRenderer(n, p, sr));
